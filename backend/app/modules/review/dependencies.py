from app.modules.review.service import ReviewService, review_service


def get_review_service() -> ReviewService:
    return review_service

