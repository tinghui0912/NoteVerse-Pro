"""
NoteVerse Pro 开发服务器启动脚本
"""
import uvicorn

if __name__ == "__main__":
    # 检测是否为开发环境
    try:
        from app.core.config import settings
        debug_mode = settings.DEBUG
    except Exception:
        debug_mode = False

    print(f"Startup mode: {'development' if debug_mode else 'production'}")

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=debug_mode,
        log_level="info",
    )
