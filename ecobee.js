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
/*
    pub.on('ready', function(e){
        let data = JSON.stringify( { module: 'ecobee', service: { name: 'sentinel-ecobee', port: 5050 } });
        pub.publish( 'sentinel.plugin.start', data);
    });
*/

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

        switch( mode ){
            case 'auto':
                return ecobeeApi.resumeProgram( id );
            case 'continuous':
                return ecobeeApi.setFan( id, 'on');
            case 'periodic':
                return ecobeeApi.setFan( id, 'on', 2);
            case 'off':
                return ecobeeApi.resumeProgram( id );
        }
    };

    this.setHvacMode = (id, mode) =>{

        switch (mode) {
            case 'resume':
                return ecobeeApi.resumeProgram( id );
            case 'heat':
                return ecobeeApi.setValue( id, 'hvacMode', 'heat');
            case 'cool':
                return ecobeeApi.setValue( id, 'hvacMode', 'cool');
            case 'auto':
                return ecobeeApi.setValue( id, 'hvacMode', 'auto');
            case 'away':
                return ecobeeApi.setAway( id );
            case 'home':
                return ecobeeApi.resumeProgram( id );
            case 'off':
                return ecobeeApi.setValue( id, 'hvacMode', 'off');
        }
    };

    this.setHvacTemp_H = (id, value) =>{
        return new Promise( (fulfill, reject) => {

            statusCache.get(id, (err, current) => {
                if (err)
                    return reject(err);
                try {
                    current.temperature.heat.set = value;

                    statusCache.set(id, current);

                    ecobeeApi.setHold( id, {
                        holdType: 'nextTransition',
                        coolHoldTemp: current.temperature.cool.set * 10,
                        heatHoldTemp: current.temperature.heat.set * 10
                    })
                        .then( (result) => {
                            fulfill( result );
                        })
                        .catch( (err) => {
                            reject( err );
                        });

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
                    current.temperature.cool.set = value;

                    statusCache.set(id, current);

                    ecobeeApi.setHold( id, {
                        holdType: 'nextTransition',
                        coolHoldTemp: current.temperature.cool.set * 10,
                        heatHoldTemp: current.temperature.heat.set * 10
                    })
                        .then( (result) => {
                            fulfill( result );
                        })
                        .catch( (err) => {
                            reject( err );
                        });

                }catch(err){
                    reject(err);
                }
            }, true);

        });
    };


    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            try {
                ecobeeApi.getCurrent()
                    .then( (data) => {

                        let devices = [];

                        for (let x in data.thermostatList) {

                            let thermostat = data.thermostatList[x];

                            let d = {
                                name: thermostat.name,
                                id: thermostat.identifier,
                            };

                            for (let y in thermostat.remoteSensors) {
                                let sensor =  thermostat.remoteSensors[y];

                                //if ( sensor.type !== 'thermostat' ) {
                                    let s = {
                                        name: sensor.name,
                                        id: thermostat.identifier + '.' + sensor.id.replace(':', '_'),
                                    };

                                    statusCache.set(s.id, fillSensorStatus(sensor));
                                //}
                            }

                            statusCache.set(d.id, fillThermostatStatus(thermostat));
                        }

                        fulfill(devices);
                    })
                    .catch( (err) =>{
                        reject(err);
                    });

            } catch(err){
                reject(err);
            }
        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    function fillThermostatStatus(thermostat){

        let thermostatStatus = {
            mode: thermostat.settings.hvacMode,
            state: "off",
            fan:{
                mode: thermostat.runtime.desiredFanMode,
                running: thermostat.runtime.desiredFanMode !== 'auto'
            },
            temperature : {
                cool: {
                    set: thermostat.runtime.desiredCool / 10.0
                },
                heat: {
                    set: thermostat.runtime.desiredHeat / 10.0
                },
                current: thermostat.runtime.actualTemperature / 10.0,
                humidity: thermostat.runtime.actualHumidity
            },
            battery: {
                level: 100
            }
        };

        return thermostatStatus
    }

    function fillSensorStatus(sensor){

        let sensorStatus = {
            armed: true, //sensor.inUse,
            temperature: {
                current: 0
            },
            tripped: {
                current: false
            }
        };

        for (let z in sensor.capability) {
            let capability = sensor.capability[z];

            switch (capability.type) {
                case 'temperature':
                    sensorStatus.temperature.current = (capability.value / 10.0);
                    break;
                case 'occupancy':
                    sensorStatus.tripped.current = ( capability.value === 'true');
                    break;
            }
        }

        return sensorStatus;
    }

    function loadSystem(){
        return new Promise( ( fulfill, reject ) => {
            try {
                ecobeeApi.getDevices()
                    .then( (data) => {

                        let devices = [];

                        for (let x in data.thermostatList) {

                            let thermostat = data.thermostatList[x];

                            let d = {
                                name: thermostat.name,
                                id: thermostat.identifier,
                                where: {'location': {city: thermostat.location.city, room: ''}},
                                type: 'hvac',
                                current: {}
                            };

                            for (let y in thermostat.remoteSensors) {
                                let sensor =  thermostat.remoteSensors[y];

                                //if ( sensor.type !== 'thermostat' ) {
                                    let s = {
                                        name: sensor.name,
                                        id: thermostat.identifier + '.' + sensor.id.replace(':', '_'),
                                        type: 'sensor.temperature',
                                        current: {}
                                    };

                                    deviceCache.set(s.id, s);

                                    devices.push(s);

                                    statusCache.set(s.id, fillSensorStatus(sensor));
                                //}
                            }

                            deviceCache.set(d.id, d);

                            devices.push(d);

                            statusCache.set(d.id, fillThermostatStatus(thermostat));
                        }

                        fulfill(devices);
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
                                if ( err.error === 'authorization_pending' ) {
                                    setTimeout(pollSystem, 1000);
                                    return;
                                } else if ( err.error === 'slow_down' ) {
                                    setTimeout(pollSystem, 60000);
                                    return;
                                } else if ( err.error === 'authorization_expired' ){
                                    setTimeout(pollSystem, 1000);
                                    return;
                                } else if ( err.error === 'invalid_grant' ){
                                    setTimeout(pollSystem, 1000);
                                    return;
                                } else if ( err.error === 'empty_response' ){
                                    setTimeout(pollSystem, 1000);
                                    return;
                                } else if ( err.error === 'invalid_response' ){
                                    setTimeout(pollSystem, 1000);
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
                if ( err && err.error ){
                    if ( err.error === 'authorization_pending' ) {
                        setTimeout(init, 1000);
                        return;
                    } else if ( err.error === 'slow_down' ) {
                        setTimeout(init, 60000);
                        return;
                    } else if ( err.error === 'authorization_expired' ){
                        setTimeout(init, 1000);
                        return;
                    } else if ( err.error === 'invalid_grant' ){
                        setTimeout(init, 1000);
                        return;
                    } else if ( err.error === 'empty_response' ){
                        setTimeout(init, 1000);
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