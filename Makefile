.PHONY: build dev clean

# 一键打包：前端 + Rust release
build:
	cd web && npm run build
	cargo build --release
	@echo "✅ target/release/acp-link"

# 开发模式
dev:
	cargo run

# 清理
clean:
	rm -rf web/dist target
