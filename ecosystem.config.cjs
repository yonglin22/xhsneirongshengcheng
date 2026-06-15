// pm2 启动配置：pm2 start ecosystem.config.cjs
// 注意：业务配置（key/短信/域名等）一律放服务器的 .env —— server.js 会用 .env 覆盖环境变量。
// 这里只设 NODE_ENV（.env 里该项默认注释，所以此处生效，强制生产模式关后门）。
module.exports = {
  apps: [{
    name: 'zhusha',
    script: 'server.js',
    node_args: '--disable-warning=ExperimentalWarning',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '600M',
    env: { NODE_ENV: 'production' }
  }]
};
