# Dependency maintenance policy

## Application ownership

An application directly declares a package when it consumes that package through
a runtime/source import, build/config import, script-invoked CLI, test framework,
provider or plugin, intentional peer dependency ownership, or another explicit
application-level contract. Review source, configuration, scripts, setup files,
and per-file test environment directives before removing a declaration.

When a tool moves an internal dependency to a required peer dependency, an
application intentionally using that toolchain normally declares and provides the
peer explicitly. Do not rely on package-manager auto-installed peers just to avoid
direct ownership. For example, Vitest 5 requires the application to provide a
compatible Vite installation. This is an intentional peer-provider contract, not
promotion of an ordinary transitive dependency merely for version visibility.

Do not promote a transitive package to a direct dependency merely to expose its
version, deduplicate globally, control an upstream implementation detail, or make
Dependabot show a preferred target. A redundant direct declaration is not justified
solely as a version-management target; the committed lockfile provides reproducibility.

Upstream packages normally own their internal dependencies. Respect their declared
semver ranges and exact versions. Prefer natural parent resolution over global
substitution, even when correct ownership retains more than one package version.

## Overrides are registered exceptions

Use an override only for concrete evidence: security remediation unavailable
naturally upstream, a documented compatibility defect, temporary ecosystem
breakage, or another independently demonstrated necessity. Prefer the narrowest
selector. Global deduplication alone is not a valid reason. Overriding a parent's
exact version requires explicit written compatibility justification and validation.

Every override needs a reason, scope, security/compatibility evidence, exit
condition, and review/removal trigger. Register it in
[dependency-exceptions.json](../../.github/dependency-exceptions.json) in the same
change as the manifest. Each record identifies the manifest, selector path,
requested version, category, reason, evidence, exit condition, and review trigger.
Selector arrays follow the nesting of npm's override object; a `.` self-override
is represented by its enclosing selector path. Preserve selector text exactly.

The [checker](../../.github/scripts/dependency_governance.py) requires a one-to-one
match between live overrides and registry records in Customer Web and Platform
Admin. It rejects missing, obsolete, duplicate, mismatched, and incomplete records.
Their path-scoped Quality workflows run its unit tests and the live check from
the repository root. Run locally with:

```sh
python3 -m unittest discover -s .github/scripts -p test_dependency_governance.py -v
python3 .github/scripts/dependency_governance.py
```

Direct-dependency ownership remains a reviewed principle; the checker does not
pretend static import analysis can establish every application contract. It also
does not prove that an exception's rationale remains valid. Review evidence again
when its owner, requested version, advisory state, or removal trigger changes.

Exceptions are temporary unless their necessity remains demonstrable. When
upstream naturally resolves a safe, compatible version, remove the override and
its registry record together. Recheck the installed ownership graph, audits, and
applicable compatibility/image gates; do not replace an obsolete global pin with
another pin merely to retain deduplication.

## Security maintenance

Prefer, where practical:

1. Upgrade the owning direct dependency.
2. Allow an existing parent range to resolve a patched version.
3. Upgrade the parent package.
4. Use a temporary scoped override.
5. Document accepted upstream-blocked debt with a review trigger.

Do not automatically run `npm audit fix --force`, force unsupported peers, or
downgrade a healthy framework/toolchain solely to silence audit output. Attribute
unique advisories separately from propagated affected-package entries. Distinguish
development findings from the actual retained production dependency graph.
Record registry, time, tool versions, and full/production JSON audit results;
advisory data can change without a lockfile change. Production findings must not
be hidden by development-toolchain cleanup.

The image Trivy gate is a separate CRITICAL-severity control; it does not certify
zero npm HIGH findings. Preserve scanner policy and report upstream-blocked debt
without unofficial forks, audit suppression, or destructive npm-force workarounds.

## Stable major versions and review boundaries

The project is pre-release. Proactively evaluate migration to stable, supported
major versions once ecosystem compatibility is established. Accept necessary
code/config changes for a healthier long-term stack; do not preserve obsolete
architecture solely to minimize the short-term diff. Do not adopt framework
prereleases/canaries by default, force unsupported peer combinations, or use
`--force` as a migration strategy.

Ownership/exception cleanup and behavior-changing major migrations need clear
review boundaries. A cleanup PR should not silently include ESLint, Vitest,
TypeScript, React, or framework major migrations. A separately justified stable
jsdom migration may accompany verified test-environment ownership when its own
compatibility evidence is explicit.

Related modernization changes may share one branch and PR. Multiple coherent
commits are allowed and preferred when each is independently understandable;
there is no one-commit requirement. Review lockfile changes per commit and
attribute every changed package entry to the intended ownership closure. Reject
unrelated resolver churn; avoid broad dependency updates.

Every head-changing push needs fresh applicable CI on the final head. Only that
final reviewed head is eligible for merge. Applicable gates include governance,
component Quality, generated-contract checks, images, production prune/audits,
and documentation links. Normal merge commits preserve those review boundaries.

## Current enforcement boundary

Override registration is checked by component CI. Component workflows remain
path-scoped; making every existing component check globally required would leave
unrelated PRs waiting for checks that do not run. This policy does not change
repository settings, branch protection, or the PR Governance trust model.

See [GitHub merge policy](github-merge-policy.md) for current platform limitations.
CI evidence does not itself prevent direct pushes or make the repository-defined
workflow producer an immutable trust boundary. Independent review and current-main
verification remain necessary.
