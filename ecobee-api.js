'use strict';
require('array.prototype.find');

function ecobeeApi() {

    const request = require('request');
    const moment = require('moment');

    const https = require('https');
    const keepAliveAgent = new https.Agent({ keepAlive: true });

    let apiKey = 'crcLaVjD5CBmZ4qduhnqHL7ce03ZKEOB';

    let ecobeePin;

    let accessToken;

    let that = this;

    function call(method, body, url) {

        return new Promise( (fulfill, reject) => {

            accessToken = global.config.auth;

            if (!accessToken || !accessToken.access_token){
                requestToken()
                    .then( (token) => {
                        let wasRefresh = (accessToken);
                        accessToken = token;
                        global.config['auth'] = accessToken;
                        global.config.auth['expires_at'] = moment.utc().add(token.expires_in, 'm').format();
                        global.config.save()
                            .then( () => {
                                if ( wasRefresh ){
                                    return call(method, body, url);
                                } else {
                                    fulfill();
                                }
                            })
                            .catch( (err) => {
                                reject(err);
                            })
                    })
                    .catch( (err) =>{
                        global.config['auth'] = null;
                        global.config.save();
                        reject(err);
                    });

                return;
            }

            let options = {
                method: method,
                url: url,
                //encoding: null,
                timeout: 30000,
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
                request(options, function (err, response, body) {
                    if (err)
                        reject(err);

                    let r = JSON.parse(body);

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
                                //global.config.save();

                            // Authentication token has expired.
                            case 14:
                                global.config.auth['expired'] = true;
                                // Retry the operation
                                return call(method, body, url);
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
                            return requestToken();
                        })
                        .catch((err) => {
                            reject(err);
                        });
                    return;
                }

                let next_poll = moment(ecobeePin.next_poll);

                if (moment().utc() < next_poll) {

                    console.log(`ecobee authorization is pending.`);

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
                    includeSensors: true
                }
            };

            get( 'https://api.ecobee.com/1/thermostat?format=json', o )
            .then( (data) => {
                fulfill(data);
            }).
            catch( (err) =>{
                reject(err);
            });

        });

    };

}

module.exports = new ecobeeApi();