# Load environment variables from .env file
include .env

.PHONY: tests tests-basic lint install mypy update ui-install ui-run build-rust develop clean

# Build commands
build-rust:
	maturin develop --release --manifest-path docetl/rust/Cargo.toml

develop: clean build-rust
	poetry install --all-extras

clean:
	rm -rf target/
	rm -rf docetl/rust/target/
	rm -f docetl/resolver/resolver*.so
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name "*.so" -delete

# Install command now includes Rust build
install: clean
	pip install poetry maturin
	$(MAKE) develop

# Existing commands
tests: clean build-rust
	poetry run pytest

tests-basic: clean build-rust
	poetry run pytest tests/basic
	poetry run pytest tests/test_api.py
	poetry run pytest tests/test_runner_caching.py

lint:
	poetry run ruff check docetl/* --fix

mypy:
	poetry run mypy

update:
	poetry update

# New UI-related commands
UI_DIR := ./website 

install-ui:
	cd $(UI_DIR) && npm install

run-ui-dev:
	@echo "Starting server..."
	@python server/app/main.py & \
	echo "Starting UI development server..." && \
	cd $(UI_DIR) && HOST=${FRONTEND_HOST}  PORT=${FRONTEND_PORT} npm run dev

run-ui:
	@echo "Starting server..."
	@python server/app/main.py & \
	echo "Building UI..." && \
	cd $(UI_DIR) && npm run build && HOST=${FRONTEND_HOST}  PORT=${FRONTEND_PORT} NEXT_PUBLIC_FRONTEND_ALLOWED_HOSTS=${FRONTEND_ALLOWED_HOSTS} npm run start

# Help command
help:
	@echo "Available commands:"
	@echo "  make tests        : Run all tests"
	@echo "  make tests-basic  : Run basic tests"
	@echo "  make lint         : Run linter"
	@echo "  make install      : Install dependencies using Poetry"
	@echo "  make mypy         : Run mypy for type checking"
	@echo "  make update       : Update dependencies"
	@echo "  make install-ui   : Install UI dependencies"
	@echo "  make run-ui-dev   : Run UI development server"
	@echo "  make run-ui-prod  : Run UI production server"
	@echo "  make help         : Show this help message"