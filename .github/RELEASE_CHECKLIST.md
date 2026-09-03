# Release checklist

Use this checklist for one exact candidate. Do not reuse evidence from another SHA,
working tree, archive, machine, or external-service session.

## Candidate identity

- [ ] Candidate version is `0.1.0` and the intended tag is `v0.1.0`.
- [ ] Candidate SHA is recorded: `________________________________________`.
- [ ] The candidate is reviewed from a clean worktree.
- [ ] The source archive digest matches the digest recorded in release evidence.

## Automated gates

- [ ] `npm ci --ignore-scripts` completed from the lockfile.
- [ ] `npm run release:audit -- --mode Full --candidate v0.1.0-rc.4` returned zero.
- [ ] `release-evidence/v0.1.0-rc.4/evidence-complete.json` exists, reports
  `completion_status: pass`, and matches the candidate, source SHA, report, and checksums.
- [ ] Every hard-gate step in `release-evidence/v0.1.0-rc.1/report.json` is `pass`.
- [ ] Current-tree and reachable-history scans are `pass`.
- [ ] Unit, integration, contract, Python, and both browser profiles are `pass`.
- [ ] npm and Python vulnerability checks have no release-blocking finding.
- [ ] The combined CycloneDX SBOM is present and bound to this candidate.
- [ ] The generated dependency-license inventory is present and its flagged
  metadata has been included in the human legal review.
- [ ] Clean-archive verification reports `CLEAN_ARCHIVE_VERIFY=PASS`.

## Human and external-state gates

- [ ] A maintainer reviewed the diff, public claims, screenshots, and evidence bundle.
- [ ] Copyright ownership, asset rights, dependency licenses, and required notices
  were reviewed by a human.
- [ ] Commit metadata was reviewed for personal information and the owner accepted
  it or completed an authorized remediation.
- [ ] Repository visibility, Actions, branch protection/rulesets, secret scanning,
  push protection, vulnerability reporting, and least-privilege workflow permissions
  were observed in the release repository.
- [ ] Account-backed WXO, optional Instana, Forgejo, and IBM Bob claims remain `not_asserted` unless
  candidate-bound evidence from an explicitly authorized session is attached.
- [ ] If Bob Shell execution is claimed, the manual workflow ran for this exact SHA,
  its deterministic and credentialed jobs were separate, GitHub's successful
  `needs` result preceded local creation of `gates.json` in the fresh advisory job,
  no gate artifact was transferred, and the validated `evidence-complete.json`, JSON
  report, and human disposition are attached without overwriting earlier evidence.
- [ ] `BOB_API_KEY` and any required `BOB_TEAM_ID` were protected `bob-review`
  Environment secrets, were exposed only to the Bob step, and were not collected as
  manual workflow-dispatch inputs or retained in evidence.
- [ ] If IBM Bob IDE use is described, the wording distinguishes the maintainer's
  reported process from independently published commit-level provenance.
- [ ] No credentials, tenant exports, private URLs, customer data, or unrelated
  binaries are present in source, history, archive, SBOM, logs, or attachments.

## Human release decision

- [ ] Release owner recorded `GO` for the exact candidate SHA.
- [ ] The signed/annotated tag and hosted release were created only after `GO`.
- [ ] Published archive and SBOM digests were checked against retained evidence.
- [ ] Post-publication smoke and download verification completed.

Automation may recommend a disposition, but it does not check any human-owned box
and cannot merge, tag, publish, deploy, import, or promote on its own.
