#!/usr/bin/env bash
# Скачивает веса модели и текст её лицензии.
#
# Веса в git не идут: файл весит десятки мегабайт, а репозиторий публичный. Правило жёсткое —
# у части моделей этого класса код открыт, а веса разрешены только для некоммерческого
# использования, поэтому лицензия кладётся рядом с файлом и проверяется глазами.
#
# Использование:  ./fetch-model.sh [каталог назначения]
set -euo pipefail

DEST_DIR="${1:-/opt/cutout-runner/models}"
MODEL_NAME="birefnet-general-lite.onnx"

# birefnet-general-lite (BiRefNet-general, backbone swin_v1_tiny). Лицензия — MIT
# и на код, и на карточку модели. Замер 2026-09-03: полутон на кромке 0,2–0,4%.
MODEL_URL="https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx"
MODEL_MD5="4fab47adc4ff364be1713e97b7e66334"
LICENSE_URL="https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE"

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

echo "Скачивание лицензии -> ${DEST_DIR}/LICENSE-birefnet.txt"
curl -fL --retry 3 -o "${DEST_DIR}/LICENSE-birefnet.txt" "$LICENSE_URL"
chmod 0444 "${DEST_DIR}/LICENSE-birefnet.txt"

echo
echo "Готово. Проверь, что в лицензии написано MIT:"
head -3 "${DEST_DIR}/LICENSE-birefnet.txt"
