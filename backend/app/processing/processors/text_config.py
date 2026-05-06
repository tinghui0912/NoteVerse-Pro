"""Central configuration for OCR, text classification, and XML layout."""


class OcrConfig:
    """Thresholds for OCR recognition and downstream filtering."""

    MIN_CONFIDENCE_THRESHOLD = 0.1
    CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.2


class ClassificationConfig:
    """Rules for classifying recognized text regions."""

    TITLE_POSITION_THRESHOLD = 0.25
    SUBTITLE_POSITION_THRESHOLD = 0.5
    BOTTOM_TEXT_THRESHOLD = 0.8

    COMPOSER_KEYWORDS = [
        "作曲",
        "曲",
        "编曲",
        "钢琴编曲",
        "改编",
        "编配",
        "Composer",
        "Music by",
        "Arranger",
        "Arranged by",
    ]
    LYRICIST_KEYWORDS = [
        "作词",
        "词",
        "原唱",
        "演唱",
        "Lyricist",
        "Lyrics by",
        "Singer",
        "Performed by",
    ]

    TITLE_EXCLUDE_KEYWORDS = [
        "作词",
        "作曲",
        "编曲",
        "原唱",
        "演唱",
        "©",
        "copyright",
    ]

    COPYRIGHT_KEYWORDS = [
        "©",
        "copyright",
        "版权",
        "rights",
        "侵权",
        "请勿转载",
        "未经允许",
    ]
    COPYRIGHT_CONTEXT_KEYWORDS = ["版权", "所有", "copyright", "rights"]
    COPYRIGHT_SPLIT_MARKERS = ["未经允许", "请勿转载", "侵权必究"]


class XmlLayoutConfig:
    """Layout constants aligned with MuseScore 4 A4 export output."""

    TITLE = {
        "default_y": "1611.210312",
        "font_size": "22",
        "justify": "center",
        "valign": "top",
        "credit_type": "title",
    }

    SUBTITLE = {
        "default_y": "1554.060198",
        "font_size": "14",
        "justify": "center",
        "valign": "top",
        "credit_type": "subtitle",
    }

    COMPOSER_INFO = {
        "default_x": "1114.7587",
        "default_y": "1511.210312",
        "justify": "right",
        "valign": "bottom",
    }

    LYRICIST_INFO = {
        "default_x": "85.725171",
        "default_y": "1511.210312",
        "justify": "left",
        "valign": "bottom",
    }

    TITLE_CENTER_X = "600.241935"

    COPYRIGHT = {
        "default_x": "600.241935",
        "default_y": "85.725171",
        "font_size": "9",
        "justify": "center",
        "valign": "bottom",
        "credit_type": "rights",
    }


OCR_CORRECTIONS = {
    "(C)": "©",
    "(c)": "©",
    "[C]": "©",
    "[c]": "©",
    "曲:": "曲：",
    "词:": "词：",
    "编曲:": "编曲：",
    "作曲:": "作曲：",
    "作词:": "作词：",
    "Arr.": "编曲：",
    "Comp.": "作曲：",
}
