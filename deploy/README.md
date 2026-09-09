# Установка `cutout_runner` на чистую Ubuntu

Инструкция написана под человека, который сервис не писал: каждая команда выполнима как есть,
догадываться не требуется нигде. Проверка инструкции — в том, что по ней ставит именно такой
человек (`docs/TZ.md` NFR-07).

**Что уже должно быть на машине** (в scope установки не входит): вход только по ключу, root
закрыт, `ufw` пускает 22, 80 и 443, включены `fail2ban` и автообновления безопасности.

**Чего на машине быть не должно, никогда:** ни одного ключа родительского проекта — ни ключей
Supabase, ни строки подключения к базе, ни доступа к хранилищу
([ADR-0006](../docs/adr/0006-service-trust-boundary.md)).

---

## 1. Пакеты и пользователь

```bash
sudo apt update
sudo apt install -y curl git nginx

# Node LTS (22.x)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # ожидается v22.x

# Отдельный непривилегированный пользователь без домашнего каталога и без оболочки
sudo useradd --system --no-create-home --shell /usr/sbin/nologin cutout
```

## 2. Код

```bash
sudo mkdir -p /opt/cutout-runner
sudo chown "$USER":"$USER" /opt/cutout-runner
git clone <адрес репозитория> /opt/cutout-runner
cd /opt/cutout-runner

# ONNXRUNTIME_NODE_INSTALL=skip обязателен. Без него postinstall onnxruntime-node качает
# CUDA-сборку ORT и распаковывает libonnxruntime_providers_cuda.so - 230 МБ ради GPU,
# которого на коробке нет. На машине меньше ~2 ГБ это не медленно, а смертельно: npm ci
# убивает OOM-killer (код 137), причём падение выглядит как «tsc: not found» на следующем
# шаге, а не как нехватка памяти.
#
# Отрезается ровно лишнее, а не наугад: script/install-metadata.js объявляет для linux/x64
# единственное требование ["cuda12"], а libonnxruntime.so.1 (44,7 МБ) и onnxruntime_binding.node
# лежат в самом npm-пакете и остаются на месте. Проверено 2026-09-09 установкой с нуля.
# На машине меньше ~1,5 ГБ ОЗУ npm ci убивает OOM и С этим флагом - ему самому не хватает
# памяти на дерево зависимостей. Тогда нужен файл подкачки; на коробке в 1 ГБ это норма,
# а не костыль. swappiness=10 - чтобы своп остался страховкой, а не режимом работы:
#     sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
#     sudo mkswap /swapfile && sudo swapon /swapfile
#     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
#     echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
# Сама служба свопом не пользуется: замер 2026-09-09 на 1 ГБ дал VmSwap: 0 kB.
ONNXRUNTIME_NODE_INSTALL=skip npm ci

npm run build
npm test        # 56 проверок, весов и сети не требуют
```

## 3. Веса модели и её лицензия

Весов в репозитории нет: файл весит десятки мегабайт, а репозиторий публичный.

```bash
sudo mkdir -p /opt/cutout-runner/models
sudo chown "$USER":"$USER" /opt/cutout-runner/models
bash deploy/fetch-model.sh /opt/cutout-runner/models
```

Скрипт проверяет контрольную сумму (несовпадение — остановка) и кладёт рядом текст лицензии
`LICENSE-u2net.txt`. **Прочитай его глазами: Apache-2.0 в нём покрывает КОД U-2-Net, но не
веса.** Веса используются по предварительному письменному согласию авторов от 2026-09-06;
до коммерческого запуска согласие должно быть переведено в явное разрешение (это долг, а не
формальность: у части моделей этого класса код открыт, а веса разрешены только некоммерчески).

## 4. Секрет и файл окружения

```bash
# Сгенерировать секрет. Это же значение получает вызывающая сторона — передавать его
# отдельно от репозитория.
openssl rand -hex 32

sudo cp deploy/cutout-runner.env.example /etc/cutout-runner.env
sudo nano /etc/cutout-runner.env          # подставить настоящий секрет и число потоков

sudo chown root:root /etc/cutout-runner.env
sudo chmod 600 /etc/cutout-runner.env     # читает только root
# Файл разбирает сам systemd (от root) ДО запуска процесса, поэтому пользователю
# cutout доступ к нему не нужен — и не даётся.
```

`CUTOUT_THREADS` ставится по числу ядер машины, но обычно не больше 4: замер 2026-09-06 на
`u2netp` дал 0,55 с на одном потоке против 0,25 с на четырёх — потоки помогают, но после
четырёх отдача пропадает.

Числа выше сняты на машине разработки и **на коробке не проверялись**. Правило проверяемое, а
не заученное: поставить 1, замерить, увеличивать по замеру. Прежние числа этого раздела
(24 / 15,8 / 13,0 / 12,0 с) относились к BiRefNet и к `u2netp` неприменимы.

Число ядер:

```bash
nproc
```

## 5. Права и служба

```bash
sudo chown -R root:root /opt/cutout-runner
sudo chmod -R go-w /opt/cutout-runner

sudo cp deploy/cutout-runner.service /etc/systemd/system/cutout-runner.service
sudo systemctl daemon-reload
sudo systemctl enable --now cutout-runner
sudo systemctl status cutout-runner --no-pager
```

Первые ~5 секунд служба грузит сессию ORT. Журнал:

```bash
sudo journalctl -u cutout-runner -n 30 --no-pager
```

Ожидаемая последовательность событий: `server.listening` → `model.loaded` → `service.ready`.

## 6. Проверка до nginx

```bash
curl -s http://127.0.0.1:8787/health
# {"status":"ok","ready":true}

# Порт наружу не смотрит — только 127.0.0.1 (docs/TZ.md FR-13):
sudo ss -tlnp | grep 8787
```

## 7. TLS и nginx

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --webroot -w /var/www/html -d <домен>

sudo cp deploy/nginx.conf /etc/nginx/conf.d/cutout-runner.conf
sudo nano /etc/nginx/conf.d/cutout-runner.conf   # заменить cutout.example.com на настоящий домен
sudo nginx -t
sudo systemctl reload nginx
```

Автопродление сертификата ставится certbot'ом само (таймер `certbot.timer`); проверить:

```bash
systemctl list-timers certbot.timer --no-pager
sudo certbot renew --dry-run
```

## 8. Приёмка

Полный список — `docs/TZ.md` §9. Минимум, который надо пройти прямо на машине.

**Делай паузу 3–6 с между запросами к `/cutout`.** Проверки ниже ломаются о собственный
`limit_req` из `deploy/nginx.conf` (`rate=30r/m`, `burst=2`): пять POST подряд дают 429, и
пункты 3 и 4 выглядят проваленными, хотя сервис исправен. Это исправная работа ограничителя,
а не поломка - но выглядит одинаково, и на этом уже теряли время (2026-09-09).

```bash
DOMAIN=<домен>
SECRET=<тот же секрет, что в /etc/cutout-runner.env>

# 1. Живость снаружи по TLS и редирект с http://
curl -s "https://$DOMAIN/health"                      # {"status":"ok","ready":true}
curl -sI "http://$DOMAIN/health" | head -1            # 301
# сертификат валиден (проверку делает сам curl, без -k) и TLS не ниже 1.2 (NFR-03):
curl -s -o /dev/null -w "verify=%{ssl_verify_result}\n" "https://$DOMAIN/health"   # verify=0
# TLS ниже 1.2 обязан отбиваться. Проверять ТОЛЬКО с Linux и ТОЛЬКО так: на Windows curl
# ходит через schannel, который сам не умеет TLS 1.1, и отказ приходит от клиента - это
# не доказательство. Тот же род ошибки, что и `nc` на порту ниже: инструмент отвечает за
# себя, а не за сервер. Клиенту здесь явно разрешено предложить 1.1, поэтому отказ может
# прийти только с сервера:
echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" \
     -tls1_1 -cipher 'ALL:@SECLEVEL=0' 2>&1 | grep -i 'alert|protocol'
#   ожидается: tlsv1 alert protocol version (alert number 70) - отказ СЕРВЕРА

# 2. Без секрета и с неверным секретом — 401 оба раза, одинаково
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     -H "Content-Type: image/png" --data-binary @frame.png "https://$DOMAIN/cutout"
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer wrong" \
     -H "Content-Type: image/png" --data-binary @frame.png "https://$DOMAIN/cutout"

# 3. Настоящий кадр — PNG ровно того же размера
curl -s -X POST -H "Authorization: Bearer $SECRET" -H "Content-Type: image/png" \
     --data-binary @frame.png "https://$DOMAIN/cutout" -o cutout.png
file frame.png cutout.png          # ширина и высота обязаны совпасть

# 4. Кадр без узнаваемого товара — 204 без тела
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $SECRET" \
     -H "Content-Type: image/png" --data-binary @no-product.png "https://$DOMAIN/cutout"

# 5. Порт наружу закрыт. Проверяется ДВУМЯ фактами вместе — по отдельности каждый лжёт.
# На машине: привязка обязана быть к петле.
sudo ss -tlnp | grep 8787          # 127.0.0.1:8787, НЕ 0.0.0.0:8787 и не [::]:8787
# Снаружи, с ЛЮБОЙ другой машины: проверять ПРОТОКОЛОМ, а не установкой соединения.
#   curl -s -o /dev/null -w "%{http_code}
" --max-time 8 http://<домен>:8787/health
#   ожидается 000 — то есть ответа нет
# Почему не `nc -vz`: в сети Beget стоит SYN-прокси, рукопожатие TCP завершается на ЛЮБОМ
# порту. Проверено на 8787, 9999, 12345, 54321 — все четыре "открыты" при отсутствии HTTP.
# Установщик получал ложную тревогу и шёл искать несуществующую дыру.

# 6. Пик памяти под нагрузкой — сотни мегабайт, заметно ниже MemoryHigh.
#    Локально на u2netp пик процесса модели 320 МиБ (замер 2026-09-06); на коробке проверять
#    по VmHWM, а не выборкой rss: выборка на JS (process.memoryUsage) не срабатывает ни разу
#    внутри блокирующего session.run(), а к возврату память уже отдана. На коробке это дало
#    65 МБ при настоящем пике 3551 МБ — занижение в 16 раз и одна ненужная покупка железа.
#    Это же и проверка, что арена ORT выключена: по коду её проверять бессмысленно.
grep VmHWM /proc/$(systemctl show cutout-runner -p MainPID --value)/status   # пик за жизнь процесса
systemd-cgtop -1 --order=memory | grep cutout-runner
sudo systemctl show cutout-runner -p MemoryPeak

# 7. Перезапуск не требует ручных действий
sudo systemctl restart cutout-runner
curl -s http://127.0.0.1:8787/health   # сразу: {"status":"loading","ready":false} — сокет уже поднят
sleep 10
curl -s http://127.0.0.1:8787/health   # {"status":"ok","ready":true}
sudo journalctl -u cutout-runner -n 5 --no-pager
#   server.listening -> model.loaded -> service.ready, без единой ручной команды между ними
systemctl is-enabled cutout-runner     # enabled — служба переживёт и перезагрузку машины
```

Совпадение RGB пиксель в пиксель (пункт 3 §9) проверяется на любой машине с Python:

```bash
python3 - <<'EOF'
from PIL import Image
a = Image.open('frame.png').convert('RGB')
b = Image.open('cutout.png')
assert a.size == b.size, (a.size, b.size)
assert b.mode == 'RGBA', b.mode
assert list(a.getdata()) == list(b.convert('RGB').getdata()), 'RGB разошёлся'
alpha = b.getchannel('A').getdata()
half = sum(1 for v in alpha if 0 < v < 255) / len(alpha)
print(f'OK: размер {a.size}, полутон на кромке {half:.3%}')
EOF
```

Пункт 8 §9 — не команда, а условие прогона: по этому файлу ставит человек, который сервис не
писал, и нигде не догадывается. Каждое место, где пришлось догадаться или подсмотреть в код, —
правка этого файла в том же изменении, а не устное пояснение установщику.

### Если запрос не падает и не завершается

Потолок `MemoryHigh` **ниже** настоящего пика даёт не отказ, а троттлинг cgroup: процесс
уходит в состояние `D` (непрерываемый сон), запрос висит, в журнале тишина. Отказ без единой
строки в логе — почти всегда это.

```bash
systemctl show cutout-runner -p MemoryCurrent -p MemoryHigh -p MemoryMax
ps -o pid,stat,rss -p $(systemctl show cutout-runner -p MainPID --value)   # STAT=D — это оно
```

С `u2netp` (пик 320 МиБ против лимита 1200M) случай маловероятен, но описание остаётся: он уже
стоил времени однажды, и при смене весов на более тяжёлые вернётся первым.

## 9. Обновление

```bash
cd /opt/cutout-runner
sudo -u "$USER" git pull
npm ci
npm run build
sudo systemctl restart cutout-runner
```

Веса при обновлении кода **не перекачиваются**: они лежат отдельно и живут дольше релиза.

### Смена модели на уже установленной коробке

Модель и активация — пара, и разъезжается она молча. Порядок ровно такой:

```bash
bash deploy/fetch-model.sh /opt/cutout-runner/models   # новые веса + текст лицензии
sudoedit /etc/cutout-runner.env                        # CUTOUT_MODEL_PATH и CUTOUT_ACTIVATION
sudo cp deploy/cutout-runner.service /etc/systemd/system/   # лимиты памяти под новую модель
sudo systemctl daemon-reload
sudo systemctl restart cutout-runner
```

Старые веса удалять только после того, как `/health` ответил `ready`. Активацию не угадывать:
`minmax` для семейства U-2-Net, `sigmoid` для BiRefNet — перепутанная валит запрос понятной
ошибкой, но лучше не проверять это на живом трафике.

## 10. Что вернуть родительскому проекту

Без этого работа не закрыта:

1. **адрес сервиса** и **имя переменной с секретом** — они пойдут в конфигурацию вызывающего,
   не в код;
2. **числа замера на самой машине**: время инференса и пик памяти. Локальные 0,55 с на
   одном потоке и 320 МиБ — ориентир с более сильной машины;
3. **всё, что пришлось изменить в контракте**, если пришлось. Молчаливое расхождение
   обнаружится пустым слоем в оплаченной карточке, а не тестом.
