# SkyDrive Enterprise (轻量网盘系统)

SkyDrive Enterprise 是一个基于现代技术栈构建的轻量级网盘。后端采用 **FastAPI** 提供高性能 API 服务，前端采用 **Vite + React** 构建响应式用户界面。支持文件上传、下载、管理以及登录注册等功能。

---

## 📋 目录

- [项目结构](#-项目结构)
- [环境要求](#-环境要求)
- [⚙️ 配置详解 (环境变量)](#-配置详解-环境变量)
- [🚀 部署指南](#-部署指南)
  - [方式一：Docker 容器化部署 (推荐)](#方式一docker-容器化部署-推荐)
  - [方式二：本地开发环境部署](#方式二本地开发环境部署)
- [💻 前端开发](#-前端开发)
- [❓ 常见问题与故障排查](#-常见问题与故障排查)

---

## 📂 项目结构

```text
agent-test/
├── backend/                # 后端项目根目录
│   ├── app/                # 应用核心代码
│   │   ├── api/            # API 路由定义
│   │   │   ├── api_v1/     # V1 版本 API
│   │   │   │   └── endpoints/
│   │   │   │       ├── files.py    # 文件管理接口
│   │   │   │       ├── login.py    # 登录认证接口
│   │   │   │       ├── shares.py   # 文件分享接口
│   │   │   │       └── users.py    # 用户管理接口
│   │   │   └── deps.py     # 依赖注入 (如获取当前用户)
│   │   ├── core/           # 核心配置
│   │   │   ├── config.py   # 配置加载 (Pydantic)
│   │   │   └── security.py # 安全相关 (JWT, 密码哈希)
│   │   ├── crud/           # 数据库 CRUD 操作
│   │   │   ├── crud_file.py
│   │   │   ├── crud_share.py
│   │   │   └── crud_user.py
│   │   ├── db/             # 数据库连接与会话管理
│   │   │   ├── base.py     # 导入所有模型供 Alembic 使用
│   │   │   └── session.py  # 数据库会话工厂
│   │   ├── models/         # 数据库模型 (SQLAlchemy)
│   │   │   ├── file.py
│   │   │   ├── share.py
│   │   │   └── user.py
│   │   ├── schemas/        # Pydantic 数据模型 (请求/响应)
│   │   │   ├── auth.py
│   │   │   ├── file.py
│   │   │   ├── share.py
│   │   │   ├── token.py
│   │   │   └── user.py
│   │   ├── utils/          # 工具函数
│   │   │   └── auth_utils.py # 验证码、签名验证等
│   │   ├── .env            # [重要] 配置文件
│   │   ├── initial_data.py # 初始化数据脚本
│   │   └── main.py         # 程序入口
│   ├── upload_storage/     # 默认文件存储目录
│   ├── Dockerfile          # Docker 构建文件
│   ├── docker-compose.yml  # Docker 编排文件
│   ├── prestart.sh         # 启动前置脚本
│   └── requirements.txt    # Python 依赖列表
├── frontend/               # 前端项目根目录
│   ├── public/             # 静态资源
│   ├── src/                # 源代码
│   │   ├── components/     # 通用组件
│   │   │   └── PrivateRoute.tsx # 路由守卫组件
│   │   ├── pages/          # 页面组件
│   │   │   ├── Dashboard.tsx    # 主面板 (文件列表)
│   │   │   ├── Login.tsx        # 登录/注册页
│   │   │   └── Share.tsx        # 分享链接访问页
│   │   ├── utils/          # 工具函数
│   │   │   └── crypto.ts        # 加密与签名工具
│   │   ├── App.tsx         # 根组件 (路由配置)
│   │   └── main.tsx        # 入口文件
│   ├── index.html          # HTML 模板
│   ├── package.json        # 项目依赖配置
│   ├── tsconfig.json       # TypeScript 配置
│   └── vite.config.ts      # Vite 配置
└── README.md               # 项目说明文档
```

---

## ✅ 环境要求

*   **Docker & Docker Compose**: 推荐用于生产环境和快速体验。
*   **Python**: 3.9+ (仅本地开发需要)。
*   **Node.js**: 16+ (仅前端开发需要)。
*   **MySQL**: 8.0 (如果不使用 Docker 内置数据库)。

---

## ⚙️ 配置详解 (环境变量)

项目的核心配置位于 `backend/app/.env` 文件中。在启动项目前，请务必检查并修改此文件。

### 1. 基础与安全配置

| 变量名 | 必填 | 默认值/示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `PROJECT_NAME` | 是 | `SkyDrive Enterprise` | 项目名称，显示在 API 文档标题中。 |
| `API_V1_STR` | 是 | `/api/v1` | API 接口的前缀。 |
| `SECRET_KEY` | **是** | `YOUR_SECRET_KEY...` | **重要**：用于加密 JWT Token。生产环境请务必生成一个随机的长字符串。 |
| `ALGORITHM` | 是 | `HS256` | 加密算法，通常保持默认即可。 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 是 | `10080` | Token 过期时间（分钟），默认 7 天。 |
| `SALT` | **是** | `YOUR_SALT_HERE` | **签名盐值**。用于前端请求签名验证。**必须与前端 `frontend/src/utils/crypto.ts` 中的 `SALT` 保持一致**。 |
| `PASSWORD_SALT` | **是** | `PASSWORD_SALT` | **密码盐值**。用于密码哈希加盐。 |

### 2. 数据库配置 (MySQL)

> **注意**：本项目支持 Docker 自动部署 MySQL。以下 `MYSQL_*` 变量会被 `docker-compose.yml` 读取以初始化数据库容器。

| 变量名 | 必填 | 默认值/示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `MYSQL_DATABASE` | 是 | `skydrive` | 数据库名称。 |
| `MYSQL_USER` | 是 | `skydrive` | 数据库用户名。 |
| `MYSQL_PASSWORD` | **是** | `Chace6688.` | 数据库密码。**请设置强密码**。 |
| `MYSQL_ROOT_PASSWORD` | **是** | `RootPassword...` | MySQL Root 用户密码。 |
| `SQLALCHEMY_DATABASE_URI` | 否 | (见下文) | **SQLAlchemy 连接字符串**。<br>Docker 部署时：通常不需要手动设置，代码会自动根据上述变量构建连接。<br>本地开发时：需手动取消注释并配置为 `mysql+pymysql://user:pass@localhost:3306/db`。 |

### 3. 存储配置

| 变量名 | 必填 | 默认值/示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `STORAGE_PATHS_STR` | 是 | `F:\SkyDrive...` | **文件存储路径**。<br>支持多个路径，用逗号 `,` 分隔。<br>在 Docker 环境中，请确保这些路径已挂载到容器内（默认挂载了 `/app/upload_storage`）。 |

### 4. 邮件服务配置 (SMTP)

用于发送注册验证码、通知等。

| 变量名 | 必填 | 示例 | 说明 |
| :--- | :---: | :--- | :--- |
| `MAIL_SERVER` | 是 | `smtp.qcloudmail.com` | SMTP 服务器地址。 |
| `MAIL_PORT` | 是 | `465` | SMTP 端口 (通常 SSL 为 465, TLS 为 587)。 |
| `MAIL_USERNAME` | 是 | `user@example.com` | 发件人邮箱账号。 |
| `MAIL_PASSWORD` | 是 | `password` | 邮箱授权码或密码。 |
| `MAIL_SSL_TLS` | 是 | `True` | 是否启用 SSL/TLS (对应端口 465)。 |
| `MAIL_STARTTLS` | 是 | `False` | 是否启用 STARTTLS (对应端口 587)。 |

---

## 🚀 部署指南

### 方式一：Docker 容器化部署 (推荐)

这是最简单的部署方式，包含后端服务和 MySQL 数据库。

1.  **进入后端目录**
    ```bash
    cd backend
    ```

2.  **检查配置**
    打开 `app/.env` 文件，确保 `MYSQL_PASSWORD` 和 `SECRET_KEY` 已修改为安全的值。

3.  **启动服务**
    ```bash
    docker-compose up -d --build
    ```
    *   `-d`: 后台运行。
    *   `--build`: 确保重新构建镜像以应用最新的代码更改。

4.  **验证状态**
    ```bash
    docker-compose ps
    ```
    确保 `skydrive-backend` 和 `skydrive-db` 状态均为 `Up`。

5.  **访问服务**
    *   **API 文档**: [http://localhost:8899/docs](http://localhost:8899/docs)
    *   **数据库端口**: 本地 `3307` (映射到容器 `3306`)。

### 方式二：本地开发环境部署

适用于需要调试代码或不使用 Docker 的场景。

1.  **准备数据库**
    *   确保本地安装了 MySQL 8.0+。
    *   创建一个名为 `skydrive` 的空数据库。
    *   修改 `app/.env`：
        *   注释掉 Docker 相关的 `SQLALCHEMY_DATABASE_URI`。
        *   启用本地的 `SQLALCHEMY_DATABASE_URI` (指向 `localhost`)。

2.  **安装依赖**
    ```bash
    cd backend
    # 建议创建虚拟环境
    python -m venv venv
    # Windows 激活虚拟环境
    venv\Scripts\activate
    # Linux/Mac 激活虚拟环境
    source venv/bin/activate
    
    pip install -r requirements.txt
    ```

3.  **运行服务**
    ```bash
    # 确保在 backend 目录下
    python app/main.py
    ```
    服务将启动在 `http://127.0.0.1:8899`。

---

## 💻 前端开发

1.  **进入前端目录**
    ```bash
    cd frontend
    ```

2.  **配置加密盐值**
    打开 `src/utils/crypto.ts`，找到 `SALT` 变量，确保其值与后端 `.env` 中的 `SALT` 保持一致。
    ```typescript
    // src/utils/crypto.ts
    const SALT = "YOUR_SALT_HERE"; // 必须与后端配置一致
    ```

3.  **安装依赖**
    ```bash
    npm install
    ```

4.  **启动开发服务器**
    ```bash
    npm run dev
    ```

---

## ❓ 常见问题与故障排查

**Q1: Docker 启动失败，提示端口被占用？**
*   **原因**: 本地端口 `8899` (后端) 或 `3307` (数据库) 已被其他程序占用。
*   **解决**: 修改 `docker-compose.yml` 中的 `ports` 映射，例如将 `"8899:8899"` 改为 `"8900:8899"`。

**Q2: 数据库连接失败？**
*   **Docker 模式**: 检查 `docker-compose logs backend`。确保 `backend` 服务等待 `db` 服务启动完成。如果是首次启动，MySQL 初始化可能需要几秒钟。
*   **本地模式**: 检查 `.env` 中的 `SQLALCHEMY_DATABASE_URI` 是否指向了正确的本地 MySQL 地址（通常是 `localhost` 而不是 `db`）。

**Q3: 邮件发送失败？**
*   检查 `MAIL_PORT`、`MAIL_SSL_TLS` 和 `MAIL_STARTTLS` 的组合是否正确。
*   某些云服务器默认封禁 25 端口，请务必使用 SSL (465) 端口。

**Q4: 上传文件报错 "No such file or directory"?**
*   确保 `STORAGE_PATHS_STR` 配置的路径存在。
*   在 Docker 中，确保该路径已在 `docker-compose.yml` 的 `volumes` 中正确挂载。

**Q5: 前端请求报错 "Signature verification failed"?**
*   请检查前端 `src/utils/crypto.ts` 中的 `SALT` 是否与后端 `.env` 中的 `SALT` 完全一致。
