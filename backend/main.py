# backend/main.py：BU Dorm Dash 的后端
# 现在只有一个"健康检查"接口，用来确认后端跑起来了
# 运行方法（在 bu-dorm-distance 文件夹里）：
#   backend/.venv/bin/uvicorn backend.main:app --reload --port 8001

from fastapi import FastAPI

# 创建后端应用。title 会显示在自动生成的接口说明页面（/docs）上
app = FastAPI(title="BU Dorm Dash API")


# @app.get(...) 叫"装饰器"：意思是"有人用 GET 方式访问 /api/health 时，执行下面这个函数"
# 函数返回的字典，FastAPI 会自动转成 JSON 发回给浏览器
@app.get("/api/health")
def health():
    return {"status": "ok"}
