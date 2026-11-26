from app.modules.fingering.service import FingeringService


def get_fingering_service() -> FingeringService:
    return FingeringService()
