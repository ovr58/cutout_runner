#!/usr/bin/env bash
# Скачивает веса модели и текст её лицензии.
#
# Веса в git не идут: репозиторий публичный, а лицензия на веса и лицензия на код — разные
# вещи. У модели этого сервиса они и правда разные, поэтому текст лицензии кладётся рядом с
# файлом и читается глазами, а не подразумевается.
#
# Использование:  ./fetch-model.sh [каталог назначения]
set -euo pipefail

DEST_DIR="${1:-/opt/cutout-runner/models}"
MODEL_NAME="u2netp.onnx"

# u2netp — лёгкая модель семейства U-2-Net, вход 320x320, файл 4,4 МБ.
# Замер 2026-09-06 (машина с 31,8 ГиБ, потолка нет): инференс 0,55 с на одном потоке и
# 0,25 с на четырёх, пик памяти процесса 320 МиБ. Прежняя birefnet-general-lite на том же
# железе и тем же способом — 18,7-22,3 с и 6025 МиБ.
#
# ВНИМАНИЕ, ЛИЦЕНЗИЯ. Файл LICENSE в репозитории U-2-Net (Apache-2.0) покрывает КОД. Веса
# лежат вне репозитория, и README отправляет за разрешением к авторам письмом. Владелец
# написал и 2026-09-06 получил ПРЕДВАРИТЕЛЬНОЕ согласие на коммерческое использование;
# детали оговариваются при коммерческом запуске. Риск отложен, а не закрыт: до коммерческого
# запуска лицензию надо урегулировать письменно.
MODEL_URL="https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
MODEL_MD5="8e83ca70e441ab06c318d82300c84806"
LICENSE_URL="https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE"

mkdir -p "$DEST_DIR"
tmp="$(mktemp "${DEST_DIR}/.${MODEL_NAME}.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

echo "Скачивание весов -> ${DEST_DIR}/${MODEL_NAME}"
curl -fL --retry 3 --retry-delay 2 --progress-bar -o "$tmp" "$MODEL_URL"

# Проверка суммы — часть установки, а не необязательный шаг: подменённые или недокачанные
# веса дают не отказ, а тихо неверный вырез.
echo "${MODEL_MD5}  ${tmp}" | md5sum -c -

mv "$tmp" "${DEST_DIR}/${MODEL_NAME}"
trap - EXIT
chmod 0444 "${DEST_DIR}/${MODEL_NAME}"

echo "Скачивание лицензии -> ${DEST_DIR}/LICENSE-u2net.txt"
curl -fL --retry 3 -o "${DEST_DIR}/LICENSE-u2net.txt" "$LICENSE_URL"
chmod 0444 "${DEST_DIR}/LICENSE-u2net.txt"

echo
echo "Готово."
echo "ВНИМАНИЕ: скачанный LICENSE (Apache-2.0) покрывает КОД U-2-Net, но НЕ веса."
echo "Веса используются по предварительному письменному согласию авторов от 2026-09-06."
echo "До коммерческого запуска согласие должно быть переведено в явное разрешение."
head -3 "${DEST_DIR}/LICENSE-u2net.txt"
