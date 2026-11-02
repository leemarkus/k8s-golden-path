.PHONY: verify test
verify:
	./scripts/verify.sh

test:
	node --test
