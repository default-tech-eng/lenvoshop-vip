# CI templates

These two workflow files need to be moved into `.github/workflows/` to enable
the daily product sync + auto-deploy.

```bash
mkdir -p .github/workflows
git mv ci-templates/sync.yml ci-templates/deploy.yml .github/workflows/
git commit -m "ci: enable sync + deploy workflows"
git push
```

They're shipped here (rather than in `.github/workflows/`) because the
GitHub token used to bootstrap this repo didn't have the `workflow` OAuth
scope needed to create workflow files via the API. Moving them by hand is
a one-time, two-command operation — see above.
