'use strict';
require('array.prototype.find');

function ecobeeApi() {

    const request = require('request');
    const moment = require('moment');

    const https = require('https');
    const keepAliveAgent = new https.Agent({ keepAlive: true });

    let apiKey = global.config.apiKey; //'crcLaVjD5CBmZ4qduhnqHL7ce03ZKEOB';
/*
    if ( process.env.DEBUG ) {
        apiKey = 'vWo7wfSopNBzoTvZ7Hf4UEee95r5boOR';
    }
*/
    if (!apiKey){
        console.error('Missing apiKey in configuration');
        process.exit(1);
    }

    let ecobeePin;

    let accessToken;

    let that = this;

    let currentData;

    let processDieOnAuthFail = false;

    let noPinEntryRetries = 2;

    function call(method, body, url) {

        return new Promise( (fulfill, reject) => {

            accessToken = global.config.auth;

            if (!accessToken || !accessToken.access_token || accessToken.expired){
                requestToken()
                    .then( (token) => {
                        noPinEntryRetries = 10;
                        let wasRefresh = (accessToken && accessToken.expired);
                        accessToken = token;
                        global.config['auth'] = accessToken;
                        global.config.auth['expires_at'] = moment.utc().add(token.expires_in, 'm').format();
                        global.config.save()
                            .then( () => {
                                //if ( wasRefresh ){
                                    call(method, body, url)
                                        .then( (data) => {
                                            fulfill(data);
                                        })
                                        .catch( (err) => {
                                            reject(err);
                                        });
                                    /*
                                } else {
                                    fulfill();
                                }
                                */
                            })
                            .catch( (err) => {
                                reject(err);
                            })
                    })
                    .catch( (err) =>{
//                        global.config['auth'] = null;
//                        global.config.save();
                        reject(err);
                    });

                return;
            }

            let options = {
                method: method,
                url: url,
                //encoding: null,
                timeout: 60000,
                //agent: keepAliveAgent,
                headers: {
                    Authorization: `Bearer ${accessToken.access_token}`
                }
            };

            if (body) {
                if ( method ==='GET' ){
                    options.url += `&body=${encodeURIComponent(body)}`;
                } else {
                    options['body'] = body;
                    options['contentType'] = 'text/json';
                }
            }

            try {
                request(options, function (err, response, data) {
                    if (err)
                        reject(err);

                    if (!data){
                        return reject( {
                            error: "empty_response",
                            error_description: "Received an empty response from the server.",
                            error_uri: ""
                        } );
                    }

                    let r;

                    try {
                        r = JSON.parse(data);
                    }
                    catch( err ){
                        return reject( {
                            error: "invalid_response",
                            error_description: "Received an invalid (non json) response from the server.",
                            error_uri: ""
                        } );
                    }

                    if ( r.status ){

                        switch ( r.status.code ) {
                            // Succeess
                            case 0:
                                if (!r) {
                                    return reject( {
                                        error: "empty_response",
                                        error_description: "Received an empty response from the server.",
                                        error_uri: ""
                                    } );
                                }

                                // We were authorized and if we lose that auth token (for whatever reason) bounce the app.
                                // It seems there is a bug on ecobee side where my tokens are good but they reject them. Bouncing the
                                // app retries with the existing tokens which should work. if not, then they are bad and we need to
                                // re-auth.
                                processDieOnAuthFail = true;

                                return fulfill(r);
                                break;

                            // Not authorized.
                            case 2:
                                return reject(r);
                                break;

                            // Authentication failed.
                            case 1:
                            // Invalid token. Token has been deauthorized by user. You must re-request authorization.
                            case 16:
                                console.log( 'ecobee authentication has failed, You must re-request authorization.');
                                // Wipe tokens and need to restart it all.
                                ecobeePin = null;
                                global.config.auth = {};
                                if ( processDieOnAuthFail )
                                    process.exit(1);
                                //global.config.save();

                            // Authentication token has expired.
                            case 14:
                                global.config.auth['expired'] = true;
                                global.config.auth.access_token = null;
                                // Retry the operation
                                call(method, body, url)
                                    .then( (data) => {
                                        fulfill(data);
                                    })
                                    .catch( (err) => {
                                        reject(err);
                                    });
                                return;
                                break;
                            default:
                                return reject(r);
                        }
                    }

                    reject(r);
                });
            } catch (e) {
                console.log('request error => ' + e);
                reject(e);
            }
        });
    }

    function get(url, obj) {
        return call( 'GET', obj ? JSON.stringify(obj) : null, url );
    }

    function post(url, obj) {
        return call( 'POST', JSON.stringify(obj), url );
    }

    function requestToken() {

        return new Promise( (fulfill, reject) => {

            let url;

            if (!accessToken) {
                if (!ecobeePin || !ecobeePin.code) {
                    that.requestPin()
                        .then(() => {

                            noPinEntryRetries--;

                            if ( noPinEntryRetries <= 0 ){
                                console.log('Maximum number of pin requests reached, giving up');
                                process.exit(1);
                            }

                            return requestToken();
                        })
                        .catch((err) => {
                            reject(err);
                        });
                    return;
                }

                let next_poll = moment(ecobeePin.next_poll);

                if (moment().utc() < next_poll) {

                    //console.log(`ecobee authorization is pending.`);

                    return reject(
                        {
                            error: "authorization_pending",
                            error_description: "Waiting for user to authorize application.",
                            error_uri: "https://tools.ietf.org/html/rfc6749#section-5.2"
                        }
                    );
                }

                ecobeePin['next_poll'] = next_poll.add(parseInt(ecobeePin.interval) + 2, 's').format();

                url = `https://api.ecobee.com/token?grant_type=ecobeePin&code=${ecobeePin.code}&client_id=${apiKey}&scope=smartWrite`;
            }
            else {
                url = `https://api.ecobee.com/token?grant_type=refresh_token&code=${accessToken.refresh_token}&client_id=${apiKey}&scope=smartWrite`;
            }

            request( { method: 'POST', url: url }, function (err, response, body) {

                if (err)
                    return reject(err);

                let r = JSON.parse(body);

                if ( r.error ){
                    if ( r.error === 'authorization_expired' ){
                        console.log( `ecobee authorization has expired. need to request a new ecobee pin and establish trust.`);
                        ecobeePin = null;
                    }
                    if ( r.error === 'invalid_grant' ){
                        console.log( `ecobee authorization is invalid. need to request a new ecobee pin and establish trust.`);
                        ecobeePin = null;
                        global.config.auth = null;
                    }
                    return reject(r);
                }

                return fulfill(r);
            });
        });
    }


    this.requestPin = () => {

        let url = `https://api.ecobee.com/authorize?response_type=ecobeePin&client_id=${apiKey}&scope=smartWrite`;

        return new Promise( (fulfill, reject) => {

            if ( ecobeePin ){
                let expires_at = moment( ecobeePin.expires_at );

                if ( expires_at >= moment().utc() ) {
                    console.log( `existing ecobee pin => ${ecobeePin.ecobeePin}, expires at => ${ecobeePin.expires_at}`);
                    return fulfill( ecobeePin );
                } else {
                    console.log( `ecobee pin => ${ecobeePin.ecobeePin}, has expired. requesting a new one.`);
                    ecobeePin = null;
                }
            }

            request(url, function (err, response, body) {

                if (err)
                    return reject(err);

                ecobeePin = JSON.parse(body);

                ecobeePin['expires_at'] = moment.utc().add( ecobeePin.expires_in, 'm' ).format();
                ecobeePin['next_poll'] =  moment.utc().add( parseInt(ecobeePin.interval) + 2, 's' ).format();

                console.log( `new ecobee pin => ${ecobeePin.ecobeePin}, expires at => ${ecobeePin.expires_at}`);

                return fulfill( ecobeePin );

            });
        });

    };

    this.setValue = ( id, name, value ) => {
        return new Promise( (fulfill, reject) => {

            let o = {
                selection: {
                    selectionType: 'thermostats',
                    selectionMatch: id
                },
                thermostat: {
                    settings : {
                    }
                }
            };

            o.thermostat.settings[name] = value;

            post( 'https://api.ecobee.com/1/thermostat?format=json', o )
                .then( () => {
                    fulfill();
                }).
            catch( (err) =>{
                reject(err);
            });

        });
    };

    this.callFunction = ( id, type, params ) => {
        return new Promise( (fulfill, reject) => {

            let o = {
                selection: {
                    selectionType: 'thermostats',
                    selectionMatch: id
                },
                functions:[
                    {
                        type: type,
                        params: params
                    }
                ]
            };

            post( 'https://api.ecobee.com/1/thermostat?format=json', o )
                .then( () => {
                    fulfill();
                }).
            catch( (err) =>{
                reject(err);
            });

        });
    };

    this.setFan = ( id, state, duration ) => {
        let p = {
            holdType: 'indefinite',
            heatHoldTemp: 0,
            coolHoldTemp: 0,
            isTemperatureAbsolute : false,
            isTemperatureRelative : false,
            fan: state
        };

        if ( duration ){
            p.holdType = 'holdHours';
            p['holdHours'] = duration;
        }

        return that.setHold( id, p );
    };

    this.setAway = (id ) => {
        return that.setHold( id, {
            holdType: 'indefinite',
            holdClimateRef: 'away'
        });
    };

    this.setHold = ( id, params ) => {
        return that.callFunction( id, 'setHold', params );
    };

    this.resumeProgram = ( id ) => {
        return that.callFunction( id, 'resumeProgram', { resumeAll: false } );
    };

    this.getCurrent = () => {

        return new Promise( (fulfill, reject) => {

            let o = {
                selection: {
                    selectionType: 'registered',
                    selectionMatch: '',
                    includeRuntime: true,
                    includeSettings: true,
                    includeEquipmentStatus: true,
                    includeSensors: true,
                    includeEvents: true
                }
            };

            get( 'https://api.ecobee.com/1/thermostat?format=json', o )
                .then( (data) => {
                    currentData = data;
                    fulfill(data);
                }).
            catch( (err) =>{
                reject(err);
            });

        });

    };

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {

            let o = {
                selection: {
                    selectionType: 'registered',
                    selectionMatch: '',
                    includeElectricity: true,
                    includeLocation: true,
                    includeRuntime: true,
                    includeSettings: true,
                    includeEquipmentStatus: true,
                    includeSensors: true,
                    includeEvents: true
                }
            };

            get( 'https://api.ecobee.com/1/thermostat?format=json', o )
            .then( (data) => {
                currentData = data;
                fulfill(data);
            }).
            catch( (err) =>{
                reject(err);
            });

        });

    };

}

module.exports = new ecobeeApi();