require('dotenv').config();

const config = {
    db: {
        host: process.env.DB_ADDRESS,
        name: process.env.DB_NAME,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
    },
    botToken: process.env.BOT_TOKEN,
    ngrok: process.env.NGROK
};

module.exports = config;
