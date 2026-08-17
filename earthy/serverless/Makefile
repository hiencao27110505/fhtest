.PHONY: help install sync lock add new lint fmt test run freeze freeze-all \
        deploy clean list preflight enable-apis logs describe delete
.DEFAULT_GOAL := help

FUNCTIONS_DIR := functions
FN ?=
PORT ?= 8080

# Target GCP project. Override per invocation: make deploy FN=x GCP_PROJECT=other
GCP_PROJECT ?= fhtest-502915

# APIs Cloud Functions gen2 needs (it builds on Cloud Run + Cloud Build).
REQUIRED_APIS := cloudfunctions.googleapis.com run.googleapis.com \
                 cloudbuild.googleapis.com artifactregistry.googleapis.com \
                 logging.googleapis.com eventarc.googleapis.com

# All workspace function names (directory basenames under functions/).
ALL_FNS := $(notdir $(patsubst %/,%,$(dir $(wildcard $(FUNCTIONS_DIR)/*/pyproject.toml))))

# Reads a [tool.earthy.gcf] key out of a function's pyproject.toml.
# usage: $(call gcf,<fn>,<key>)
define gcf
$(shell uv run --no-project python -c "import tomllib,sys; \
d=tomllib.load(open('$(FUNCTIONS_DIR)/$(1)/pyproject.toml','rb')); \
print(d.get('tool',{}).get('earthy',{}).get('gcf',{}).get('$(2)',''))")
endef

# Guard: FN must be set and must exist.
define need_fn
@if [ -z "$(FN)" ]; then \
  echo "error: FN is required.  e.g.  make $@ FN=helloworld"; \
  echo "available: $(ALL_FNS)"; exit 1; fi
@if [ ! -f "$(FUNCTIONS_DIR)/$(FN)/pyproject.toml" ]; then \
  echo "error: no such function '$(FN)' in $(FUNCTIONS_DIR)/"; \
  echo "available: $(ALL_FNS)"; exit 1; fi
endef

help:
	@echo "Earthy serverless (uv workspace, one shared .venv)"
	@echo
	@echo "  make install              create/refresh .venv with every function + dev tools"
	@echo "  make list                 list functions in the workspace"
	@echo "  make new FN=<name>        scaffold a new function"
	@echo "  make add FN=<name> PKG=<pkg>   add a dependency to one function"
	@echo "  make run FN=<name>        run locally on :$(PORT) with hot reload"
	@echo "  make test                 pytest across the workspace"
	@echo "  make lint / make fmt      ruff check / ruff format"
	@echo "  make freeze FN=<name>     regenerate that function's requirements.txt"
	@echo "  make freeze-all           regenerate every requirements.txt"
	@echo
	@echo "  make preflight            check auth / project / billing / APIs"
	@echo "  make enable-apis          enable the APIs gen2 needs"
	@echo "  make deploy FN=<name>     freeze + preflight + deploy"
	@echo "  make logs FN=<name>       tail the last 50 log entries"
	@echo "  make describe FN=<name>   show the deployed function"
	@echo "  make delete FN=<name>     delete the deployed function"
	@echo
	@echo "functions: $(ALL_FNS)"
	@echo "project:   $(GCP_PROJECT)"

list:
	@for f in $(ALL_FNS); do \
	  printf "  %-24s %s\n" "$$f" "$$(uv run --no-project python -c \
	    "import tomllib;d=tomllib.load(open('$(FUNCTIONS_DIR)/$$f/pyproject.toml','rb'));\
g=d.get('tool',{}).get('earthy',{}).get('gcf',{});\
print(g.get('trigger','?'),'/',g.get('entry-point','?'),'/',g.get('region','?'))")"; \
	done

install sync:
	uv sync --all-packages

lock:
	uv lock

# make add FN=helloworld PKG="httpx>=0.27"
add:
	$(need_fn)
	@if [ -z "$(PKG)" ]; then echo "error: PKG is required. e.g. make add FN=$(FN) PKG=httpx"; exit 1; fi
	uv add --package $(FN) $(PKG)
	@$(MAKE) --no-print-directory freeze FN=$(FN)

new:
	@if [ -z "$(FN)" ]; then echo "error: FN is required. e.g. make new FN=send-email"; exit 1; fi
	@if [ -e "$(FUNCTIONS_DIR)/$(FN)" ]; then echo "error: $(FUNCTIONS_DIR)/$(FN) already exists"; exit 1; fi
	@mkdir -p $(FUNCTIONS_DIR)/$(FN)
	@printf '[project]\nname = "%s"\nversion = "0.1.0"\ndescription = "HTTP Cloud Function: %s"\nrequires-python = "==3.12.*"\ndependencies = [\n    "functions-framework==3.9.2",\n]\n\n[tool.earthy.gcf]\nentry-point = "main"\ntrigger = "http"\nregion = "asia-southeast1"\nruntime = "python312"\nallow-unauthenticated = true\n\n[tool.uv]\npackage = false\n' "$(FN)" "$(FN)" > $(FUNCTIONS_DIR)/$(FN)/pyproject.toml
	@printf 'import functions_framework\n\n\n@functions_framework.http\ndef main(request):\n    return "ok"\n' > $(FUNCTIONS_DIR)/$(FN)/main.py
	@$(MAKE) --no-print-directory install
	@$(MAKE) --no-print-directory freeze FN=$(FN)
	@echo "created $(FUNCTIONS_DIR)/$(FN)  ->  make run FN=$(FN)"

run:
	$(need_fn)
	cd $(FUNCTIONS_DIR)/$(FN) && uv run --package $(FN) functions-framework \
	  --target=$(call gcf,$(FN),entry-point) \
	  --signature-type=$(call gcf,$(FN),trigger) \
	  --port=$(PORT) --debug

test:
	uv run --all-packages pytest

lint:
	uv run ruff check .

fmt:
	uv run ruff format . && uv run ruff check --fix .

# Regenerate one function's requirements.txt from its own pyproject deps.
# --no-dev keeps workspace dev tools out; --no-emit-workspace drops the local
# package self-reference (GCP has the source, not a wheel).
freeze:
	$(need_fn)
	@uv export --package $(FN) --no-hashes --no-dev --no-emit-workspace \
	  --format requirements.txt -o $(FUNCTIONS_DIR)/$(FN)/requirements.txt -q
	@echo "wrote $(FUNCTIONS_DIR)/$(FN)/requirements.txt"

freeze-all:
	@for f in $(ALL_FNS); do $(MAKE) --no-print-directory freeze FN=$$f; done

# Checks the things that make `gcloud functions deploy` fail with unhelpful
# errors: wrong/absent login, unreachable project, billing off, APIs disabled.
preflight:
	@echo "project:  $(GCP_PROJECT)"
	@acct=$$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null); \
	 if [ -z "$$acct" ]; then echo "  auth:     NOT LOGGED IN  -> gcloud auth login"; exit 1; \
	 else echo "  auth:     $$acct"; fi
	@gcloud projects describe $(GCP_PROJECT) --format='value(projectId)' >/dev/null 2>&1 \
	  || { echo "  project:  UNREACHABLE (wrong id, or no access from this account)"; exit 1; }
	@billing=$$(curl -s -H "Authorization: Bearer $$(gcloud auth print-access-token)" \
	   "https://cloudbilling.googleapis.com/v1/projects/$(GCP_PROJECT)/billingInfo" \
	   | grep -o '"billingEnabled": *[a-z]*' | grep -o '[a-z]*$$'); \
	 if [ "$$billing" != "true" ]; then \
	   echo "  billing:  DISABLED  <- blocks gen2 deploys"; \
	   echo "            enable at https://console.cloud.google.com/billing/linkedaccount?project=$(GCP_PROJECT)"; \
	   exit 1; \
	 else echo "  billing:  enabled"; fi
	@enabled=$$(gcloud services list --enabled --project=$(GCP_PROJECT) \
	   --format='value(config.name)' 2>/dev/null); \
	 missing=""; \
	 for api in $(REQUIRED_APIS); do \
	   echo "$$enabled" | grep -q "^$$api$$" || missing="$$missing $$api"; done; \
	 if [ -n "$$missing" ]; then \
	   echo "  apis:     missing ->$$missing"; \
	   echo "            run: make enable-apis"; exit 1; \
	 else echo "  apis:     all enabled"; fi
	@echo "ready to deploy."

enable-apis:
	gcloud services enable $(REQUIRED_APIS) --project=$(GCP_PROJECT)

deploy: freeze preflight
	$(need_fn)
	gcloud functions deploy $(FN) \
	  --gen2 \
	  --project=$(GCP_PROJECT) \
	  --source=$(FUNCTIONS_DIR)/$(FN) \
	  --entry-point=$(call gcf,$(FN),entry-point) \
	  --trigger-$(call gcf,$(FN),trigger) \
	  --runtime=$(call gcf,$(FN),runtime) \
	  --region=$(call gcf,$(FN),region) \
	  $(if $(filter true,$(call gcf,$(FN),allow-unauthenticated)),--allow-unauthenticated,)
	@echo
	@echo "url: $$(gcloud functions describe $(FN) --gen2 --project=$(GCP_PROJECT) \
	  --region=$(call gcf,$(FN),region) --format='value(serviceConfig.uri)' 2>/dev/null)"

describe:
	$(need_fn)
	gcloud functions describe $(FN) --gen2 --project=$(GCP_PROJECT) \
	  --region=$(call gcf,$(FN),region)

logs:
	$(need_fn)
	gcloud functions logs read $(FN) --gen2 --project=$(GCP_PROJECT) \
	  --region=$(call gcf,$(FN),region) --limit=50

delete:
	$(need_fn)
	gcloud functions delete $(FN) --gen2 --project=$(GCP_PROJECT) \
	  --region=$(call gcf,$(FN),region)

clean:
	rm -rf .venv .pytest_cache .ruff_cache
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
