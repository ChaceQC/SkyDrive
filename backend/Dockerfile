# 使用官方 Python 运行时作为父镜像
FROM python:3.9-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
# 防止 Python 生成 .pyc 文件
ENV PYTHONDONTWRITEBYTECODE 1
# 确保 Python 输出直接打印到终端，不被缓冲
ENV PYTHONUNBUFFERED 1

# 安装系统依赖
# 如果需要编译某些 Python 包（如 mysqlclient, pillow 等），可能需要安装 gcc 等工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libmariadb-dev-compat \
    libmariadb-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制项目代码
COPY . .

# 赋予 prestart.sh 执行权限
RUN chmod +x prestart.sh

# 暴露端口
EXPOSE 8899

# 启动命令
# 修改为先运行 prestart.sh，再启动应用
CMD ["bash", "-c", "./prestart.sh && uvicorn app.main:app --host 0.0.0.0 --port 8899"]
