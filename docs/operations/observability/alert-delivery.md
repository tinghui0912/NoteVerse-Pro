# Alert Delivery

Application PrometheusRules evaluate service, scheduler and asynchronous-work
health and link to targeted runbooks. Prometheus sends firing/resolved events to
Alertmanager. Receiver credentials, routes and escalation ownership are
environment configuration; checked-in alert rules alone do not establish delivery.

Before relying on an environment, send a synthetic alert and verify its intended
receiver, grouping, resolved notification, silence and critical escalation path.
Check runbook links from that environment. Group by bounded infrastructure and
alert identity, not business/resource IDs. Target-down inhibition must not hide
unrelated services or environments.

Store receiver secrets in environment-owned secret management and reference
them from configuration. Never commit raw webhooks, SMTP passwords or chat
tokens to values, ConfigMaps or release artifacts. Rotate credentials and repeat
delivery verification after receiver changes. Do not equate a green dashboard
or an installed Alertmanager Pod with an operational on-call channel.
