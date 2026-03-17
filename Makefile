.PHONY: run-gui gui build build-css install dev run-awake

BUN := ~/.bun/bin/bun
PORT ?= 2999

run-gui:
	PORT=$(PORT) $(BUN) run src/server/index.ts

gui: run-gui

run-awake:
	PORT=$(PORT) caffeinate -i $(BUN) run src/server/index.ts

dev:
	PORT=$(PORT) $(BUN) run --watch src/server/index.ts

build:
	$(BUN) build src/client/main.tsx --outdir dist/client --minify

build-css:
	$(BUN)x @tailwindcss/cli -i src/client/styles/globals.css -o dist/client/styles/globals.css

install:
	$(BUN) install

all: install build build-css
