# HTTP error contracts

`CustomerErrorCode` owns the Customer HTTP application error vocabulary.
`ControlPlaneErrorCode` independently owns the operator HTTP application error
vocabulary. Both are `StrEnum` types; matching string values do not merge their
contract authorities.

`ApiErrorResponse` and `ControlPlaneErrorResponse` expose only `code` and
`request_id`. Request correlation retains its ingress validation and response
header. Exception details and internal diagnostics remain server-owned. Response
factories admit codes into their own vocabulary and present `internal_error` for
unadmitted values. Equal wire values do not grant admission across contracts.
Shared/domain failures are translated at the owning Control Plane application
boundary when their semantics are explicitly admitted. The ops retry command
boundary translates resource-not-found and invalid-retry validation failures;
domain owners retain their eligibility rules. The Control Plane response factory
accepts only `ControlPlaneErrorCode` members and fails closed for every foreign
enum/value. Retry failure audit events record the admitted operator-facing string
code. HTTP statuses retain their exception semantics.

Composition roots supply `HttpRuntimeErrorCodes` and their response factory to
shared exception handlers and CSRF/origin middleware. Shared HTTP mechanics do not
select a product vocabulary.

The committed OpenAPI contracts are the generator source for both clients. Customer
Web uses the generated `CustomerErrorCode` union and an exhaustive presentation map;
its English and Chinese error keys exactly match that vocabulary. The map also
provides runtime code admission. Canonical application errors require a known code,
a valid request ID and exactly those two fields. Noncanonical Customer HTTP failures
use `internal_error` for 5xx and `unknown_error` otherwise.

Platform Admin validates codes against its generated `ControlPlaneErrorCodeSchema`.
Unknown codes, invalid request IDs and additional fields are noncanonical HTTP
failures; their bodies and private values do not enter application errors.

Durable operation failures, pipeline/provider diagnostics and accounting history
are separate facts. Their string codes are not the HTTP application vocabulary.
Signed object-storage upload failures likewise have their own client error owner.
