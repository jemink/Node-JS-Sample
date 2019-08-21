const functions = require('firebase-functions');
const Firebase = require('../services/firebase.service');
const Utilities = require('../services/utilities.service');
const APIError = require('../helpers/APIError');
const Mail = require('../services/mail.service');
const httpStatus = require('http-status');
const moment = require('moment-timezone');

class AdminModel {
    deleteUser(userId) {
        return Firebase.removeDoc('admins', userId);
    }

    setInvitationToken() {
        let invitation_token = Utilities.generateUID(15);
        let data = {
            "invitation_token": invitation_token,
            "url": `${functions.config().main.web_url.replace('vendor', 'admin')}/admin/signup?token=${invitation_token}`
        };
        return data;
    }
}

module.exports = new AdminModel();