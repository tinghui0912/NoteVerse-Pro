from app.modules.xml.service import XMLService


def get_xml_service() -> XMLService:
    """Provide the XML service from the XML module boundary."""
    return XMLService()
