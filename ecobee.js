'use strict';
require('array.prototype.find');

function ecobee(config) {

    if ( !(this instanceof ecobee) ){
        return new ecobee(config);
    }

    var ecobeeApi = require('./ecobee-api');

    const redis = require('redis');
    var moment = require('moment');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('ready', function(e){
        let data = JSON.stringify( { module: 'ecobee', service: { name: 'sentinel-ecobee', port: 5050 } });
        pub.publish( 'sentinel.plugin.start', data);
    });

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();

    var merge = require('deepmerge');

    var request = require('request');

/*
    require('request').debug = true
    require('request-debug')(request);
*/

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'ecobee', id : key, value : value });
        console.log( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: 'ecobee', id : key });
        console.log( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'ecobee', id : key, value : value });
        console.log( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

	var deviceMap = {};

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    this.setFanMode = (id, mode) =>{
        return new Promise( (fulfill, reject) => {
            try {
                fulfill();
            }catch(err){
                reject(err);
            }
        });
    };

    this.setHvacMode = (id, mode) =>{
        return new Promise( (fulfill, reject) => {
            try {
                fulfill();
            }catch(err){
                reject(err);
            }
        });
    };

    this.setHvacTemp_H = (id, value) =>{
        return new Promise( (fulfill, reject) => {

            statusCache.get(id, (err, current) => {
                if (err)
                    return reject(err);
                try {
                    statusCache.set(id, current);

                    fulfill();
                }catch(err){
                    reject(err);
                }
            }, true);

        });
    };

    this.setHvacTemp_C = (id, value) =>{
        return new Promise( (fulfill, reject) => {

            statusCache.get(id, (err, current) => {
                if (err)
                    return reject(err);

                try {
                    statusCache.set(id, current);

                    fulfill();
                }catch(err){
                    reject(err);
                }
            }, true);

        });
    };


    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            try {
                fulfill();
            }catch(err){
                reject(err);
            }
        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {
            try {
                ecobeeApi.getDevices()
                    .then( (devices) => {
                        fulfill();
                    })
                    .catch( (err) =>{
                        reject(err);
                    });

            } catch(err){
                reject(err);
            }
        });
    }

    function init() {
        loadSystem()

            .then(() => {

                function pollSystem() {
                    updateStatus()
                        .then(() => {
                            setTimeout(pollSystem, 10000);
                        })
                        .catch((err) => {

                            if ( err.error){
                                if ( err.error == 'authorization_pending' ) {
                                    setTimeout(init, 1000);
                                    return;
                                } else if ( err.error == 'slow_down' ) {
                                    setTimeout(init, 60000);
                                    return;
                                } else if ( err.error === 'authorization_expired' ){
                                    setTimeout(init, 60000);
                                    return;
                                }
                            }

                            console.error(err);
                            process.exit(1);
                            //setTimeout(pollSystem, 60000);
                        });
                }

                setTimeout(pollSystem, 10000);

            })
            .catch((err) => {

                if ( err.error){
                    if ( err.error == 'authorization_pending' ) {
                        setTimeout(init, 1000);
                        return;
                    } else if ( err.error == 'slow_down' ) {
                        setTimeout(init, 60000);
                        return;
                    } else if ( err.error === 'authorization_expired' ){
                        setTimeout(init, 60000);
                        return;
                    }
                }
                console.error(err);
                process.exit(1);
            });
    }

    init();

    return this;
}

module.exports = ecobee;