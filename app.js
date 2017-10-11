'use strict';

const SwaggerExpress = require('swagger-express-mw');
const SwaggerUi = require('swagger-tools/middleware/swagger-ui');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const redis = require('redis');

const uuid = require('node-uuid');

const consul = require('consul')( {
    host: process.env.CONSUL || '127.0.0.1',
    promisify: true
});

app.use(bodyParser.json({limit: '50mb'}));
app.use(cookieParser());

var _config = {
    appRoot: __dirname, // required config
    swaggerSecurityHandlers: {
        Oauth: (req, authOrSecDef, scopesOrApiKey, cb) => {
            if (scopesOrApiKey == "open") {
                cb();
            }else {
                cb();
            }
        }
    }
};

consul.kv.get('config/sentinel/ecobee', function(err, result) {
    if (err) throw err;

    if (!result)
        result = { Value : null };

    let config = JSON.parse(result.Value);

    if (!config)
        config = {};

    config.save = function(){
        return new Promise( (fulfill, reject) => {
            consul.kv.set( 'config/sentinel/ecobee', JSON.stringify(this, null, '\t'), function(err, result) {
                if (err)
                    return reject(err);
                fulfill(result);
            })
        });
    };

    global.config = config;
    global.config.save();

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    SwaggerExpress.create(_config, function (err, swaggerExpress) {
        if (err) {
            throw err;
        }

        app.use(SwaggerUi(swaggerExpress.runner.swagger));
        // install middleware
        swaggerExpress.register(app);

        let serviceId = process.env.SERVICE_ID || uuid.v4();

        var port = process.env.PORT || 5000;
        var server = app.listen(port, () => {

            let host = require('ip').address();
            let port = server.address().port;

            var module = {
                id: serviceId,
                name: 'ecobee',
                address: host,
                port: port,
                active: true,
                endpoint : `http://${host}:${port}`,
                check: {
                    http: `http://${host}:${port}/health?id=${serviceId}`,
                    interval: '15s'
                }
            };

            process.env.SERVICE_ID = serviceId;

            pub.on('ready', function(e){

                pub.publish( 'sentinel.module.start', JSON.stringify( module, '\t' ) );

                if (swaggerExpress.runner.swagger.paths['/health']) {
                    console.log(`you can get /health?id=${serviceId} on port ${port}`);
                }

                global.module = require('./ecobee.js')(config);

            });

        });

    });

});

process.on('unhandledRejection', (reason, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    process.exit(1);
});

module.exports = app;