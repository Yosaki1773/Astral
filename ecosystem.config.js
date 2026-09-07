// PM2 进程管理配置
// 仅启动 Node 模式后端 (前端 dist/ 已通过 `npm run frontend:build` 提前构建完成,
// 由后端静态托管)。若 dist/ 缺失,请先在 frontend/ 目录跑一次 `npm run build`。
//
// 常用命令:
//   pm2 start ecosystem.config.js           # 启动
//   pm2 start ecosystem.config.js --env production   # 启动并指定环境
//   pm2 reload ecosystem.config.js          # 零停机重载
//   pm2 stop ecosystem.config.js            # 停止
//   pm2 delete ecosystem.config.js          # 删除
//   pm2 logs ai-gateway                     # 实时日志
module.exports = {
    apps: [
        {
            name: "ai-gateway",
            // 用 tsx 直接跑后端入口,避免 PM2 包装 npm script 时
            // 嵌套 npm install 出现的 PATH/.bin 解析问题
            script: "src/local.ts",
            interpreter: "npx",
            interpreter_args: "tsx",
            cwd: __dirname,
            // 单实例即可,业务数据存在 local.db,多实例会写冲突
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            max_restarts: 5,
            restart_delay: 5000,
            kill_timeout: 10000,
            wait_ready: false,
            env: {
                NODE_ENV: "production",
            },
            env_development: {
                NODE_ENV: "development",
            },
            // 日志输出到 log/ 目录,与项目日志规范保持一致
            out_file: "./log/pm2-out.log",
            error_file: "./log/pm2-error.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        },
    ],
};
