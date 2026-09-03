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

npm ci
npm run build
npm test        # 43 проверки, весов и сети не требуют
```

## 3. Веса модели и её лицензия

Весов в репозитории нет: файл весит десятки мегабайт, а репозиторий публичный.

```bash
sudo mkdir -p /opt/cutout-runner/models
sudo chown "$USER":"$USER" /opt/cutout-runner/models
bash deploy/fetch-model.sh /opt/cutout-runner/models
```

Скрипт проверяет контрольную сумму (несовпадение — остановка) и кладёт рядом текст лицензии
`LICENSE-birefnet.txt`. **Убедись глазами, что в нём написано MIT** — у части моделей этого
класса код открыт, а веса разрешены только для некоммерческого использования.

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

`CUTOUT_THREADS` ставится по числу ядер машины, но обычно не больше 4: замер 2026-09-03 дал
24 / 15,8 / 13,0 / 12,0 с на 1 / 2 / 4 / 8 потоках — после четырёх отдача падает.

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

Полный список — `docs/TZ.md` §9. Минимум, который надо пройти прямо на машине:

```bash
DOMAIN=<домен>
SECRET=<тот же секрет, что в /etc/cutout-runner.env>

# 1. Живость снаружи по TLS и редирект с http://
curl -s "https://$DOMAIN/health"                      # {"status":"ok","ready":true}
curl -sI "http://$DOMAIN/health" | head -1            # 301

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

# 6. Пик памяти под нагрузкой — близко к 600 МБ, ниже MemoryMax.
#    Это и есть проверка, что арена ORT выключена: по коду её проверять бессмысленно.
systemd-cgtop -1 --order=memory | grep cutout-runner
sudo systemctl show cutout-runner -p MemoryPeak

# 7. Перезапуск не требует ручных действий
sudo systemctl restart cutout-runner && sleep 8 && curl -s http://127.0.0.1:8787/health
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

## 9. Обновление

```bash
cd /opt/cutout-runner
sudo -u "$USER" git pull
npm ci
npm run build
sudo systemctl restart cutout-runner
```

Веса при обновлении кода **не перекачиваются**: они лежат отдельно и живут дольше релиза.

## 10. Что вернуть родительскому проекту

Без этого работа не закрыта:

1. **адрес сервиса** и **имя переменной с секретом** — они пойдут в конфигурацию вызывающего,
   не в код;
2. **числа замера на самой машине**: время инференса и пик памяти. Локальные 12–24 с — верхняя
   оценка с более сильной машины;
3. **всё, что пришлось изменить в контракте**, если пришлось. Молчаливое расхождение
   обнаружится пустым слоем в оплаченной карточке, а не тестом.
