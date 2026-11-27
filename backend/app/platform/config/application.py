"""Validated policy values shared by domain constructors and runtime projection."""

from app.platform.config.account_email_link import AccountEmailLinkSettings
from app.platform.config.public_frontend_url import PublicFrontendUrlSettings
from app.platform.config.service_identity import ServiceIdentitySettings
from app.platform.config.collaboration import CollaborationSettings
from app.platform.config.customer_session_security import CustomerSessionSecuritySettings
from app.platform.config.token_signing import TokenSigningSettings
from app.platform.config.storage import WorkDirectoryConfig
from app.platform.config.task_reliability import TaskReliabilitySettings
from app.platform.config.worker_model_engine import WorkerModelEngineSettings


class AccountEmailConfig(
    AccountEmailLinkSettings, PublicFrontendUrlSettings, ServiceIdentitySettings
):
    pass


class InvitationConfig(CollaborationSettings, PublicFrontendUrlSettings, ServiceIdentitySettings):
    pass


class CustomerAuthConfig(CustomerSessionSecuritySettings, TokenSigningSettings):
    pass


class ImportExecutionConfig(
    WorkDirectoryConfig, TaskReliabilitySettings, WorkerModelEngineSettings
):
    pass
