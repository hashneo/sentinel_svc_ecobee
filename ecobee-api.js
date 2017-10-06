'use strict';
require('array.prototype.find');

function ecobeeApi() {

    const request = require('request');
    const moment = require('moment');

    let apiKey = 'crcLaVjD5CBmZ4qduhnqHL7ce03ZKEOB';

    let ecobeePin;

    this.requestPin = () => {

        let url = `https://api.ecobee.com/authorize?response_type=ecobeePin&client_id=${apiKey}&scope=smartWrite`;

        return new Promise( (fulfill, reject) => {

            if ( ecobeePin ){
                let expires_at = moment( ecobeePin.expires_at );

                if ( expires_at >= moment() ) {
                    return fulfill( ecobeePin );
                }
            } else {
                ecobeePin = null;
            }

            request(url, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    ecobeePin = JSON.parse(body);

                    ecobeePin['expires_at'] = moment.utc().add( ecobeePin.expires_in, 'm' ).format();

                    ecobeePin['next_poll'] =  moment.utc().add( parseInt(ecobeePin.interval) + 2, 's' );

                    return fulfill( ecobeePin );
                }else{
                    reject(error || response);
                }
            });
        });

    };

    function getToken() {

        return new Promise( (fulfill, reject) => {

            if (!ecobeePin || !ecobeePin.code){
                return reject(
                    {
                        "error": "authorization_expired",
                        "error_description": "The authorization has expired.",
                        "error_uri": "https://tools.ietf.org/html/rfc6749#section-5.2"
                    }
                );
            }

            if ( ecobeePin ){
                let next_poll = moment( ecobeePin.next_poll );

                if ( next_poll < moment() ) {
                    return reject(
                        {
                            "error": "authorization_pending",
                            "error_description": "Waiting for user to authorize application.",
                            "error_uri": "https://tools.ietf.org/html/rfc6749#section-5.2"
                        }
                    );
                }
            } else {

            }

            let url = `https://api.ecobee.com/authorize?grant_type=ecobeePin&code=${ecobeePin.code}&client_id=${apiKey}&scope=smartWrite`;

            request(url, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    let r = JSON.parse(body);

                    if ( r.error ){
                        if ( r.error === 'authorization_expired' ){
                            ecobeePin = null;
                        }
                        return reject(r);
                    }

                    ecobeePin['expires_at'] = moment.utc().add( ecobeePin.expires_in, 'm' ).format();

                    return fulfill( ecobeePin );
                }else{
                    reject(error || response);
                }
            });
        });


    }
}

module.exports = new ecobeeApi();