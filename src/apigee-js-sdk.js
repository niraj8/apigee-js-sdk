import axios from 'axios';
import isUrl from 'is-url';
import qs from 'qs';
import axiosDebugLog from 'axios-debug-log';

const debug = require('debug')('apigee-js-sdk');
const apigeeLogger = require('debug')('axios-apigee');

function rejectValidation(module, parameter) {
    return Promise.reject(new Error(`The ${module} ${parameter} is not valid or it was not specified properly`));
}

// [{name:'foo', value:'bar'},...] => {foo:bar}
function objectify(properties_array) {
    const result = {};
    properties_array.forEach((property) => {
        result[property.name] = ['true', 'false'].includes(property.value) ? property.value === 'true' : property.value;
    });
    return result;
}

function toPropertyArray(object) {
    return object.map((k, v) => {
        return { name: k, value: v }
    })
}


class APICall {
    constructor(options) {
        if (!options.baseURL || !options.tokenURL || !options.username || !options.password) {
            throw new Error('missing fields in config');
        }

        // todo validate username, password not empty
        if (!isUrl(options.baseURL)) throw new Error('base url provided is not valid');
        if (!isUrl(options.tokenURL)) throw new Error('token url provided is not valid');

        this.baseURL = options.baseURL;
        this.tokenURL = options.tokenURL;
        this.username = options.username;
        this.password = options.password;
        this.options = options;
        this.token = null;

        const axiosConfig = {
            baseURL: this.baseURL,
            responseType: 'json'
        };

        if (options && options.proxyEnabled && options.proxy) axiosConfig.proxy = options.proxy;

        this.apigee = axios.create(axiosConfig);
        axiosDebugLog.addLogger(this.apigee, apigeeLogger);
    }

    async getToken() {
        // making sure the token is valid for at least next 30 seconds
        if (this.token && this.token.expiry_timestamp > new Date().getTime() / 1000 + 30) {
            return this.token;
        }
        if (this.token && this.token.refresh_token) {
            // todo: if refresh_token fails generate using password grant_type
            return this._generateToken('refresh_token');
        }
        return this._generateToken('password');
    }

    async _generateToken(grant_type = 'password') {
        // todo: mfa token and saml
        const formData = { grant_type };

        if (grant_type === 'password') {
            formData.username = this.username;
            formData.password = this.password;
        } else if (grant_type === 'refresh_token') {
            formData.refresh_token = this.token.refresh_token;
        }

        const tokenResponse = await axios(this.tokenURL, {
            method: 'post',
            auth: {
                username: 'edgecli',
                password: 'edgeclisecret'
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json;charset=utf-8'
            },
            data: qs.stringify(formData)
        });

        if (tokenResponse.status === 200) {
            const expiry_timestamp = Math.floor(new Date().getTime() / 1000 + tokenResponse.data.expires_in);
            const tokenObject = Object.assign(tokenResponse.data, { expiry_timestamp });
            delete tokenObject.expires_in;
            debug('new access_token generated');
            this.token = tokenObject;
            return tokenObject;
        }
        return Promise.reject(new Error({
            status: tokenResponse.status,
            message: tokenResponse.status,
            body: tokenResponse.data
        }));
    }

    async send(url, method = 'get', headers = {}, data = {}) {
        const token = await this.getToken();
        const response = await this.apigee(url, {
            method,
            data,
            headers: {Authorization: `Bearer ${token.access_token}`, ...headers}
        });

        if (response.status >= 400) {
            const error = {
                status: response.status,
                message: response.statusText,
                body: response.data // todo respond with more controlled data
            };
            debug('api request failed, res => %O', response);
            throw new Error(JSON.stringify(error));
        }
        if (response.status >= 200 && response.status <= 202) {
            debug('response data %j', response.data);
            return response.data;
        }
        return {};
    }
}

class Apigee {
    constructor(options) {
        this.org = options.org;
        this.options = options;

        this.api = new APICall(options);
    }

    // apiproxy

    async createEmptyProxy({ name }) {
        if (!name || !name.match(/^[A-Za-z0-9-_]+$/)) {
            return rejectValidation('proxy', 'name');
        }
        return this.api.send(`v1/o/${this.org}/apis`, 'POST', {}, { name });
    }

    async listProxies() {
        return this.api.send(`v1/o/${this.org}/apis`);
    }

    async listProxyRevisions({ name }) {
        return this.api.send(`v1/o/${this.org}/apis/${name}/revisions`);
    }

    async _getOrDeleteProxy({ name, method, revision }) {
        let url = `v1/o/${this.org}/apis/${name}`;
        if (revision) url += `/revisions/${revision}`;
        return this.api.send(url, method);
    }

    // apiproxy
    async getProxy({ name, revision }) {
        return this._getOrDeleteProxy({ name, method: 'get', revision });
    }

    async deleteProxy({ name, revision }) {
        // todo add undeploy option
        return this._getOrDeleteProxy({ name, method: 'delete', revision });
    }

    async importProxy({ name, filePath, validate = true }) {
        const formData = new FormData();
        formData.append('file', filePath);
        // todo handle failures(name already present, proxy folder structure invalid)
        return this.api.send(`v1/o/${this.org}/apis?action=import&name=${name}&validate=${validate}`,
            'post', { 'Content-Type': 'multipart/form-data' }, formData);
    }

    // todo return what? bundle or location
    async downloadProxy({ name, revision }) {
        return this.api.send(`v1/o/${this.org}/apis/${name}/revisions/${revision}?format=bundle`);
    }

    async undeployProxy({ name }) {
        return this.listProxyRevisions(name)
            .then((revisions) => Promise.all(revisions.map((revision) => this.undeployProxyRevision({
                name,
                revision
            }))));
    }

    // todo
    // eslint-disable-next-line class-methods-use-this
    async forceUndeployProxyRevision() { return null; }

    async undeployProxyRevision({ name, revision }) {
        return this.api.send(`v1/o/${this.org}/apis/${name}/revisions/${revision}/deployments`, 'DELETE');
    }

    async installNodeDependencies({ name, revision }) {
        if (!name || !revision) return rejectValidation('installNodeDependencies', 'name or revision');
        return this.api.send(`v1/o/${this.org}/apis/${name}/revisions/${revision}/npm`, 'post', {
            'Content-Type': 'application/x-www-form-urlencoded'
        }, { command: 'install' });
    }

    // .env

    async listEnvironments() {
        return this.api.send(`v1/o/${this.org}/e`);
    }

    async getEnvironment({ name }) {
        return this.api.send(`v1/o/${this.org}/e/${name}`)
            .then((data) =>
                // objectify the properties
                Object.assign(data, { properties: objectify(data.properties.property) }));
    }

    // todo: manage on-prem only methods
    async createEnvironment({ name, description = '', props = {} }) {
        const properties = { property: [] };
        Object.keys(props).forEach((key) => properties.property.push({ name: key, value: props[key] }));
        const newEnvironment = { name, description, properties };
        return this.api.send(`v1/o/${this.org}/e`, 'post', {}, newEnvironment);
    }

    async updateEnvironment({ name, description, props = {} }) {
        // fetch .env props, and update the ones that have to be updated
        const properties = { property: [] };
        Object.keys(props).forEach((key) => properties.property.push({ name: key, value: props[key] }));
        const config = { name, description, properties };
        return this.api.send(`v1/o/${this.org}/e`, 'post', {}, config);
    }

    // todo: document critical methods and make them available via another interface
    async deleteEnvironment() {
        // delete all virtual hosts in .env
        await this.deleteAllVirtualHosts();

        // disassociate the .env from all message processors
        await this.disassociateMessageProcessor();

        // clean up analytics
        await this.cleanAnalytics()
    }

    async deleteAllVirtualHosts() {
        // todo
    }

    // deployments

    async proxyRevisionDeployments({ name, revision }) {
        return this.api.send(`v1/o/${this.org}/apis/${name}/revisions/${revision}/deployments`);
    }

    async proxyDeployments({ name }) {
        return this.api.send(`v1/o/${this.org}/apis/${name}/deployments`);
    }

    // list deployments for a proxy in .env
    async proxyDeploymentsForEnvironment({ apiproxy, env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/apis/${apiproxy}/deployments`)
    }

    // list deployments for each proxy deployed in .env
    async allProxyDeploymentsForEnvironment() {
        return this.api.send(`v1/o/${this.org}/deployments`)
    }

    async proxyDeploymentsForOrg() {
        return this.api.send(`v1/o/${this.org}/deployments?includeServerStatus=false&includeApiConfig=false`);
    }

    async getEnvironmentDeployments({ name, resource = ['apiproxy', 'sharedflow'] }) {
        // todo
        // return this.api.send(`v1/o/${this.org}/e/${name}/deployments`);
    }

    // org
    async getOrg() {
        return this.api.send(`v1/o/${this.org}`);
    }


    // caches
    async listCaches({ env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/caches`)
    }

    async getCacheDetailsForEnvironment({ name, env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/caches/${name}`)
    }

    async createCacheForEnvironment({ name, env, properties }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/caches/${name}`, 'post', {}, properties)
    }

    async updateCacheForEnvironment({
        name, env, properties, preserveProperties = true
    }) {
        let props = properties;
        const oldProps = this.getCacheDetailsForEnv({ name, env });
        if (preserveProperties) props = Object.assign(oldProps, properties);
        return this.api.send(`v1/o/${this.org}/e/${env}/caches/${name}`, 'put', {}, props)
    }

    async deleteCache({ name, env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/caches/${name}`, 'delete')
    }

    async clearCache({ name, env }) {
        return this.api.send(
            `v1/o/${this.org}/e/${env}/caches/${name}/entries?action=clear`,
            'post',
            { 'Content-Type': 'application/octet-stream' },
            {}
        )
    }

    async clearCacheEntry({ name, env, cacheKey}) {
        return this.api.send(`v1/o/${this.org}/e/${env}/caches/${name}/entries/${cacheKey}?action=clear`)
    }

    // kvm - .env
    async listKeyValueMaps({ env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/keyvaluemaps`)
    }

    async createKeyValueMap({name, env, entries, encrypted = true}) {
        let payload = { name, encrypted, entry: toPropertyArray(entries) };
        return this.api.send(`v1/o/${this.org}/e/${env}/keyvaluemaps`, 'post', {}, payload)
    }

    async getKeyValueMap({ name, env }) {
        return this.api.send(`v1/o/${this.org}/e/${env}/keyvaluemaps/${name}`)
    }

    // sharedflows

    async listSharedFlows() {
        return this.api.send(`v1/o/${this.org}/sharedflows`);
    }

    async downloadSharedFlow({name, revision}) {

    }

    // apiproducts
    async listApiProducts(expand = false) {
        return this.api.send(`v1/o/${this.org}/apiproducts?expand=${expand}`)
        // todo iterate cursor and get all apiproducts if org is onprem
    }

    async getApiProduct({name}) {
        return this.api.send(`v1/o/${this.org}/apiproducts/${name}`)
    }

    // operation
    async disassociateMessageProcessor() {
        // todo
    }

    async cleanAnalytics() {
        // todo
    }
}

module.exports = Apigee;
