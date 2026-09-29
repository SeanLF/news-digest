#!/bin/sh
# Download the two candidate models into $1 (not committed: 118 MB and 434 MB) and print sha256s.
set -eu
out=$1; mkdir -p "$out/minilm" "$out/static"
hf=https://huggingface.co
get() { [ -s "$2" ] || curl -sSfL -o "$2" "$1"; }
get $hf/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_qint8_avx512.onnx "$out/minilm/model_qint8_avx512.onnx"
get $hf/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json "$out/minilm/tokenizer.json"
get $hf/sentence-transformers/static-similarity-mrl-multilingual-v1/resolve/main/0_StaticEmbedding/model.safetensors "$out/static/model.safetensors"
get $hf/sentence-transformers/static-similarity-mrl-multilingual-v1/resolve/main/0_StaticEmbedding/tokenizer.json "$out/static/tokenizer.json"
cd "$out" && find . -type f | sort | xargs shasum -a 256
