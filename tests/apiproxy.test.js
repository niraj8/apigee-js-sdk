const Apigee = require('./../dist/apigee-js-sdk');
const config = require('../config')();

let testApigeeOrg = null;

beforeAll(async () => {
    testApigeeOrg = new Apigee(config);
});

test('list proxies', async () => {
    const actual = await testApigeeOrg.listProxies();
    expect(Array.isArray(actual)).toBeTruthy()
});
