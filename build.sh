#!/bin/bash
set -e

echo "📦 构建前端..."
cd web && npm run build && cd ..

echo "🦀 构建 Rust (release)..."
cargo build --release

echo "🔏 签名..."
codesign --force -s - target/release/acp-link

echo "🔄 停止旧进程..."
pkill -9 -x acp-link || true
sleep 1

echo "📋 安装..."
cp target/release/acp-link /usr/local/bin/acp-link

echo "✅ 完成"
