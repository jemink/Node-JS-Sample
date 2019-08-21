process.on('uncaughtException', (exception) => console.log(exception));
const Config = require('./config.sevice');

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const serviceAccount = require('./../service-account.json');
const googleStorage = require('@google-cloud/storage').Storage;
const fbConfig = Config.getFbConfig();
const storage = new googleStorage({ projectId: fbConfig.project_id, keyFilename: 'service-account.json' });

const fs = require('fs');
const path = require('path');
const TEMP_DIR_PATH = path.join(__dirname, '../tmp/');

const firebaseClient = require('firebase');
const config = {
    apiKey: fbConfig.api_key,
    authDomain: fbConfig.auth_domain,
    databaseURL: fbConfig.database_url,
    projectId: fbConfig.project_id,
    storageBucket: fbConfig.storage_bucket,
    messagingSenderId: fbConfig.messaging_sender_id
};
firebaseClient.initializeApp(config);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://learn-by-hellocrowd.firebaseio.com'
});

const db = admin.firestore();
db.settings({ timestampsInSnapshots: true });

const FirebaseAuth = require('firebaseauth');
const firebase = new FirebaseAuth(fbConfig.api_key);

class FirebaseService {
    getDb() {
        return db;
    }

    createAuthUser(email, password) {
        return admin.auth().createUser({
            email: email,
            password: password
        });
    }

    createUser(email, displayName) {
        return admin.auth().createUser({
            email, displayName
        });
    }

    getAuthUserByEmail(email) {
        return admin.auth().getUserByEmail(email);
    }

    getCurrentUser() {
        return firebaseClient.auth().currentUser;
    }

    signInWithEmailAndPassword(email, password) {
        return new Promise((resolve, reject) => {
            firebase.signInWithEmail(email, password, (err, result) => {
                if (err) {
                    console.log(err);
                    return reject(err);
                } else {
                    console.log(result);
                    return resolve(result);
                }
            });
        });
        // return firebaseClient.auth().signInWithEmailAndPassword(email, password);
    }

    getUser(id) {
        return new Promise((resolve, reject) => {
            db.collection('vendors')
                .doc(id)
                .get()
                .then((doc) => {
                    let user = doc.data();
                    if (user) {
                        user.id = id;
                    }
                    return resolve(user);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getEmployee(id, tenantId) {
        return new Promise((resolve, reject) => {
            db.collection(`tenants/${tenantId}/employees`)
                .doc(id)
                .get()
                .then((doc) => {
                    let user = doc.data();
                    if (user) {
                        user.id = id;
                    }
                    return resolve(user);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getAdmins(id) {
        return new Promise((resolve, reject) => {
            db.collection('admins')
                .doc(id)
                .get()
                .then((doc) => {
                    let user = doc.data();
                    if (user) {
                        user.id = id;
                    }
                    return resolve(user);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    updateUser(id, collection, data) {
        return db
            .collection(collection)
            .doc(id)
            .update(data);
    }

    updateUserPassword(user, password) {
        return admin.auth().updateUser(user.user_id, { password });
    }

    getWhere(collection, field, equalTo) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .where(field, '=', equalTo)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getDoc(collection, id) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .doc(id)
                .get()
                .then((doc) => {
                    let item = doc.data();
                    if (item) {
                        item.id = id;
                    }
                    return resolve(item);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    pushDoc(collection, doc) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .add(doc)
                .then((ref) => resolve(ref.id))
                .catch((error) => reject(error));
        });
    }

    updateDoc(collection, id, data) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .doc(id)
                .update(data)
                .then((ref) => resolve(ref.id))
                .catch((error) => reject(error));
        });
    }

    removeDoc(collection, id) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .doc(id)
                .delete()
                .then(() => resolve())
                .catch((error) => reject(error));
        });
    }

    pushField(doc, field) {
        return new Promise((resolve, reject) => {
            db.doc(doc)
                .set(field, { merge: true })
                .then((ref) => resolve(ref))
                .catch((error) => reject(error));
        });
    }

    upload(file, path) {
        return new Promise((resolve, reject) => {
            const bucket = storage.bucket(fbConfig.storage_bucket);
            // Convert the base64 string back to file to upload into the Google Cloud Storage bucket
            const base64EncodedString = file.base64Data,
                mimeType = file.mimetype,
                fileName = `${Date.now()}_${file.name.split(' ').join('_')}`,
                fileBuffer = new Buffer(base64EncodedString, 'base64');

            // Upload the file to the bucket
            let fileUpload = bucket.file(path + fileName);

            fileUpload
                .save(fileBuffer, {
                    metadata: { contentType: mimeType }
                })
                .then((res) => {
                    return;
                })
                .catch((error) => {
                    console.log('Unable to upload the image.');
                    return reject(error);
                });

            fileUpload
                .getSignedUrl({
                    action: 'read',
                    expires: '03-09-2491'
                })
                .then((signedUrls) => {
                    console.log('URL : ' + signedUrls);
                    return resolve({ filename: fileName, url: signedUrls[0] });
                })
                .catch((error) => {
                    console.log(error);
                });
        });
    }

    uploadLocalFile(file, path, fileName) {
        return new Promise((resolve, reject) => {
            const bucket = storage.bucket(fbConfig.storage_bucket);
            const base64EncodedString = file.base64Data,
                mimeType = 'application/pdf',
                fileBuffer = new Buffer(base64EncodedString, 'base64');
            let fileUpload = bucket.file(path + fileName);

            fileUpload
                .save(fileBuffer, {
                    metadata: { contentType: 'application/pdf' }
                })
                .then((res) => {
                    return;
                })
                .catch((error) => {
                    console.log('Unable to upload the image.');
                    return reject(error);
                });

            fileUpload
                .getSignedUrl({
                    action: 'read',
                    expires: '03-09-2491'
                })
                .then((signedUrls) => {
                    return resolve({ filename: fileName, url: signedUrls[0] });
                })
                .catch((error) => {
                    console.log(error);
                });
        });
    }

    deleteFile(fileName, path) {
        return new Promise((resolve, reject) => {
            const bucket = storage.bucket(fbConfig.storage_bucket);
            let fileUpload = bucket.file(`${path}/${fileName}`);
            fileUpload
                .delete()
                .then(() => {
                    console.log(`Successfully deleted photo`);
                    return resolve();
                })
                .catch((error) => {
                    console.log(`Failed to remove photo, error: ${error}`);
                    return reject(error);
                });
        });
    }

    getBucket() {
        return storage.bucket(functions.config().fb_config.storage_bucket);
    }

    getVendorByEmail(email) {
        return new Promise((resolve, reject) => {
            db.collection('vendors')
                .where('email', '=', email)
                .limit(1)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data[0]);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getWhereArrayHas(collection, array, value) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .where(array, 'array-contains', value)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getOneWhere(collection, field, equalTo) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .where(field, '=', equalTo)
                .limit(1)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data[0]);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getUserByEmail(collection, email) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .where('email', '=', email)
                .limit(1)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data[0]);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    getAll(collection) {
        return new Promise((resolve, reject) => {
            db.collection(collection)
                .get()
                .then((snapshot) => {
                    let data = [];
                    snapshot.forEach((doc) => {
                        let item = doc.data();
                        item.id = doc.id;
                        data.push(item);
                    });
                    return resolve(data);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }

    signInWithCredentialAndReturnData(token, userData) {
        return new Promise((resolve, reject) => {
            let credential = firebaseClient.auth.GoogleAuthProvider.credential(token);
            firebaseClient
                .auth()
                .signInAndRetrieveDataWithCredential(credential)
                .then((authResponse) => {
                    if (
                        !authResponse ||
                        !authResponse.additionalUserInfo ||
                        !authResponse.additionalUserInfo.profile ||
                        !authResponse.user
                    ) {
                        return reject(new Error('Token is invalid'));
                    }
                    // console.log('\n USER:', authResponse.user);
                    const data = userData;
                    data.uid = authResponse.user.uid;
                    if (!data.name) {
                        data.name = userData.name;
                        if (!userData.name) {
                            data.name = data.email.split('@')[0].replace('.', ' ');
                        }
                    }
                    if (!data.picture) {
                        data.picture = userData.photoUrl;
                    }
                    let response = Object.assign({}, data, { email: data.email.toLowerCase() });
                    return resolve(response);
                })
                .catch((error) => {
                    return reject(error);
                });
        });
    }
}

module.exports = new FirebaseService();
