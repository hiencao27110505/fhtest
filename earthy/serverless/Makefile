.PHONY: help install sync sync-shared lock add new lint fmt typecheck test run emit authorize freeze freeze-all \
        deploy clean list preflight enable-apis logs describe delete ensure-topic \
        grant-gmail-push check-gmail-push
.DEFAULT_GOAL := help

FUNCTIONS_DIR := functions
FN ?=
PORT ?= 8080

# Target GCP project. Override per invocation: make deploy FN=x GCP_PROJECT=other
GCP_PROJECT ?= fhtest-502915

# APIs Cloud Functions gen2 needs (it builds on Cloud Run + Cloud Build).
REQUIRED_APIS := cloudfunctions.googleapis.com run.googleapis.com \
                 cloudbuild.googleapis.com artifactregistry.googleapis.com \
                 logging.googleapis.com eventarc.googleapis.com \
                 gmail.googleapis.com secretmanager.googleapis.com

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
  echo "error: FN is required.  e.g.  make $@ FN=$(firstword $(ALL_FNS))"; \
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
	@echo "  make typecheck            mypy across the workspace"
	@echo "  make sync-shared          copy shared/ modules into each function"
	@echo "  make authorize            grant Gmail access to a mailbox (opens a browser)"
	@echo "  make freeze FN=<name>     regenerate that function's requirements.txt"
	@echo "  make freeze-all           regenerate every requirements.txt"
	@echo
	@echo "  make preflight            check auth / project / billing / APIs"
	@echo "  make enable-apis          enable the APIs gen2 needs"
	@echo "  make grant-gmail-push     let Gmail publish into the watch topic"
	@echo "  make check-gmail-push     verify that grant"
	@echo "  make deploy FN=<name>     freeze + preflight + deploy"
	@echo "  make logs FN=<name>       tail the last 50 log entries"
	@echo "  make describe FN=<name>   show the deployed function"
	@echo "  make delete FN=<name>     delete the deployed function"
	@echo
	@echo "functions: $(ALL_FNS)"
	@echo "project:   $(GCP_PROJECT)"

list:
	@for f in $(ALL_FNS); do \
	  printf "  %-26s %s\n" "$$f" "$$(uv run --no-project python -c \
	    "import tomllib;d=tomllib.load(open('$(FUNCTIONS_DIR)/$$f/pyproject.toml','rb'));\
g=d.get('tool',{}).get('earthy',{}).get('gcf',{});\
t=g.get('trigger','?');\
print(t + (' -> ' + g.get('topic','(no topic!)') if t=='pubsub' else ''), '|', g.get('entry-point','?'), '|', g.get('region','?'))")"; \
	done

install sync:
	uv sync --all-packages

lock:
	uv lock

# make add FN=transaction-parser PKG="httpx>=0.27"
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

SHARED_DIR := shared

# Copies each function's declared shared modules in from shared/. Cloud
# Functions deploys one directory, so a module two functions use has to exist
# inside both — Google's own guidance is to vendor local dependencies next to
# main.py. Symlinks are not an option: gcloud tars the source preserving links,
# so one would dangle in the container.
#
# The copies are generated: shared/ is the only place to edit them.
sync-shared:
	@uv run --no-project python tools/sync_shared.py

# Interactive: opens a browser so you can grant Gmail access to one mailbox.
# Only the account owner can do this — it is the consent step, not a lookup.
# OUT=path writes the credentials to a file (mode 600) instead of printing them.
# AUTH_PORT, not PORT: PORT already means "run the function on this port" and
# defaults to 8080, which would silently override the script's own default.
#
# Whatever port you use must match a URI registered on the OAuth client. A Web
# application client accepts only the redirect URIs listed in the Console,
# unlike a Desktop client which allows any loopback port.
authorize:
	uv run python tools/gmail_authorize.py \
	  $(if $(OUT),--out $(OUT),) $(if $(AUTH_PORT),--port $(AUTH_PORT),)

# functions-framework signature types are http | event | cloudevent — a pubsub
# trigger is delivered as a cloudevent, so it does not map 1:1 to gcf.trigger.
sigtype = $(if $(filter http,$(call gcf,$(1),trigger)),http,cloudevent)

run: sync-shared
	$(need_fn)
	cd $(FUNCTIONS_DIR)/$(FN) && uv run --package $(FN) functions-framework \
	  --target=$(call gcf,$(FN),entry-point) \
	  --signature-type=$(call sigtype,$(FN)) \
	  --port=$(PORT) --debug

# Posts a Pub/Sub-shaped CloudEvent at a locally running function.
# usage: make run FN=x  (in one shell), then  make emit FN=x  (in another)
emit:
	$(need_fn)
	@payload=$$(printf '%s' '$(if $(DATA),$(DATA),{"emailAddress":"test@example.com","historyId":"12345"})' | base64); \
	curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:$(PORT)/ \
	  -H 'Content-Type: application/json' \
	  -H 'ce-id: local-1' \
	  -H 'ce-source: //pubsub.googleapis.com/projects/$(GCP_PROJECT)/topics/$(call gcf,$(FN),topic)' \
	  -H 'ce-specversion: 1.0' \
	  -H 'ce-type: google.cloud.pubsub.topic.v1.messagePublished' \
	  -d "{\"message\":{\"data\":\"$$payload\",\"messageId\":\"1\"},\"subscription\":\"local\"}"

test: sync-shared
	uv run --all-packages pytest

lint:
	uv run ruff check .

# One pass per function: each is its own import root, and they all have a
# main.py (and a conftest.py), which mypy reads as duplicate modules if they
# are checked together. --ignore-missing-imports: the Google client libraries
# ship no stubs.
typecheck:
	@for f in $(ALL_FNS); do \
	  echo "$$f:"; \
	  uv run mypy $(FUNCTIONS_DIR)/$$f --ignore-missing-imports || exit 1; \
	done

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

# Secret Manager entries a function declares in [tool.earthy] secrets, as a
# --set-secrets argument. Mounted as env vars at run time, so nothing secret is
# ever a plain --set-env-vars: a function's environment shows up in the console
# and in `gcloud functions describe`.
define secret_flags
$(shell uv run --no-project python -c "import tomllib; \
d=tomllib.load(open('$(FUNCTIONS_DIR)/$(1)/pyproject.toml','rb')); \
v=d.get('tool',{}).get('earthy',{}).get('secrets',[]); \
print('--set-secrets=' + ','.join(f'{e}:latest' for e in v) if v else '')")
endef

# http  -> --trigger-http (+ optional --allow-unauthenticated)
# pubsub -> --trigger-topic=<topic>, never publicly invocable
trigger_flags = $(if $(filter http,$(call gcf,$(1),trigger)),\
  --trigger-http $(if $(filter true,$(call gcf,$(1),allow-unauthenticated)),--allow-unauthenticated,),\
  --trigger-topic=$(call gcf,$(1),topic))

deploy: sync-shared freeze preflight
	$(need_fn)
	@if [ "$(call gcf,$(FN),trigger)" = "pubsub" ] && [ -z "$(call gcf,$(FN),topic)" ]; then \
	  echo "error: $(FN) has trigger=pubsub but no topic in [tool.earthy.gcf]"; exit 1; fi
	@$(MAKE) --no-print-directory ensure-topic FN=$(FN)
	gcloud functions deploy $(FN) \
	  --gen2 \
	  --project=$(GCP_PROJECT) \
	  --source=$(FUNCTIONS_DIR)/$(FN) \
	  --entry-point=$(call gcf,$(FN),entry-point) \
	  --runtime=$(call gcf,$(FN),runtime) \
	  --region=$(call gcf,$(FN),region) \
	  --set-env-vars=GCP_PROJECT=$(GCP_PROJECT) \
	  $(call trigger_flags,$(FN)) \
	  $(call secret_flags,$(FN))
	@echo
	@if [ "$(call gcf,$(FN),trigger)" = "http" ]; then \
	  echo "url: $$(gcloud functions describe $(FN) --gen2 --project=$(GCP_PROJECT) \
	    --region=$(call gcf,$(FN),region) --format='value(serviceConfig.uri)' 2>/dev/null)"; \
	else \
	  echo "topic: projects/$(GCP_PROJECT)/topics/$(call gcf,$(FN),topic)"; \
	fi

# Gmail's own push identity. It publishes notifications into your topic under
# this account, not under the user's credentials — the user's OAuth token
# authorizes reading their mailbox and nothing in this project. This grant is
# the only bridge between the two, so watch() fails without it.
# https://developers.google.com/workspace/gmail/api/guides/push
GMAIL_PUSH_SA := gmail-api-push@system.gserviceaccount.com
GMAIL_TOPIC ?= gmail-events

# Idempotent: re-running just re-asserts the binding.
grant-gmail-push:
	@gcloud pubsub topics describe $(GMAIL_TOPIC) --project=$(GCP_PROJECT) >/dev/null 2>&1 \
	  || { echo "creating topic $(GMAIL_TOPIC)"; \
	       gcloud pubsub topics create $(GMAIL_TOPIC) --project=$(GCP_PROJECT); }
	gcloud pubsub topics add-iam-policy-binding $(GMAIL_TOPIC) \
	  --project=$(GCP_PROJECT) \
	  --member="serviceAccount:$(GMAIL_PUSH_SA)" \
	  --role="roles/pubsub.publisher"

# Shows who may publish to the Gmail topic. Granted on the topic, not the
# project: Pub/Sub IAM is per-resource, and a project-wide grant to a Google
# system account is needlessly broad.
check-gmail-push:
	@echo "topic: $(GMAIL_TOPIC)"
	@gcloud pubsub topics get-iam-policy $(GMAIL_TOPIC) --project=$(GCP_PROJECT) \
	   --format='value(bindings.role,bindings.members)' 2>/dev/null \
	 | grep -q "$(GMAIL_PUSH_SA)" \
	 && echo "  publisher: $(GMAIL_PUSH_SA) OK" \
	 || { echo "  publisher: MISSING -> make grant-gmail-push"; exit 1; }

# Creates the trigger topic if it does not exist yet (no-op for http functions).
ensure-topic:
	$(need_fn)
	@topic="$(call gcf,$(FN),topic)"; \
	 if [ -n "$$topic" ]; then \
	   gcloud pubsub topics describe "$$topic" --project=$(GCP_PROJECT) >/dev/null 2>&1 \
	     || { echo "creating topic $$topic"; \
	          gcloud pubsub topics create "$$topic" --project=$(GCP_PROJECT); }; \
	 fi

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
