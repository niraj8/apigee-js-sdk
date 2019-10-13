const isUrl = require('is-url');
if (process.env.NODE_ENV === 'test') require('dotenv').config();
const E = process.env;

function config() {
    if (!E.APIGEE_ORGANIZATION || !E.APIGEE_USERNAME || !E.APIGEE_PASSWORD) throw new Error('missing environment variables');
    if (E.APIGEE_BASE_URL && !isUrl(E.APIGEE_BASE_URL)) throw new Error('base url provided is not valid');
    if (E.APIGEE_TOKEN_URL && !isUrl(E.APIGEE_TOKEN_URL)) throw new Error('token url provided is not valid');

    return {
        org: E.APIGEE_ORGANIZATION,
        username: E.APIGEE_USERNAME,
        password: E.APIGEE_PASSWORD,
        baseURL: E.APIGEE_BASE_URL || 'https://api.enterprise.apigee.com',
        tokenURL: E.APIGEE_TOKEN_URL || 'https://login.apigee.com/oauth/token'
    };
}

module.exports = config;
