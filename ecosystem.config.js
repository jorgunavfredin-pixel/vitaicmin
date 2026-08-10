module.exports = {
  apps: [{
    name: 'vitaicmin-bot',
    script: 'src/index.js',
    cwd: '/root/vitaicmin',
    node_args: '--dns-result-order=ipv4first',
    env: {
      NODE_OPTIONS: '--dns-result-order=ipv4first'
    },
    max_restarts: 10,
    restart_delay: 3000,
    autorestart: true
  }]
};
