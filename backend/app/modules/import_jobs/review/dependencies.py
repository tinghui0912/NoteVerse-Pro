from app.modules.import_jobs.review.service import ImportReviewService, import_review_service


def get_import_review_service() -> ImportReviewService:
    return import_review_service
