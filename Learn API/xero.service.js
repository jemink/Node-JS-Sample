const XeroClient = require('xero-node').AccountingAPIClient;
const fbConfig = require('../.runtimeconfig');
const config = {
    appType: fbConfig.xero_config.app_type,
    consumerKey: fbConfig.xero_config.consumer_key,
    consumerSecret: fbConfig.xero_config.consumer_secret,
    privateKeyPath: fbConfig.xero_config.private_key_path
};
let xero = new XeroClient(config);
const fs = require('fs');
const pathNew = require('path');
const download = require('download');
const Firebase = require('./firebase.service');
const tmp = require('tmp');
const moment = require('moment-timezone');

class XeroService {

    createContact(vendor) {
        return new Promise(async (resolve, reject) => {
            try {
                let contactObject = {
                    ContactStatus: 'ACTIVE',
                    Name: vendor.company_name,
                    FirstName: vendor.company_profile.primary_contacts.first_name,
                    LastName: vendor.company_profile.primary_contacts.last_name,
                    EmailAddress: vendor.email,
                    BankAccountDetails: vendor.company_profile.banking.account_number,
                    TaxNumber: vendor.company_profile.VAT_registration_number,
                    Addresses: [
                        {
                            AddressType: 'POBOX',
                            AddressLine1: vendor.company_profile.postal_address.postal_address_first,
                            AddressLine2: vendor.company_profile.postal_address.postal_address_second,
                            City: vendor.company_profile.postal_address.postal_city,
                            PostalCode: vendor.company_profile.postal_address.postal_zip,
                            Country: vendor.company_profile.postal_address.postal_country
                        }
                    ],
                    Phones: [
                        {
                            PhoneType: 'DEFAULT',
                            PhoneNumber: vendor.company_profile.account_contacts.phone
                        }
                    ],
                    UpdatedDateUTC: (new Date()).toUTCString()
                };

                xero.contacts.create(contactObject).then(contact => {
                    let ContactID = contact.Contacts[0].ContactID;
                    if (ContactID === '00000000-0000-0000-0000-000000000000') {
                        return resolve('error');
                    } else {
                        return resolve(ContactID);
                    }
                }).catch(error => {
                    return reject(error);
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    createPO(vendor, schedule) {
        return new Promise(async (resolve, reject) => {
            try {
                const organisation = 'Dimension Data';
                let PurchaseOrderObject = {
                    Contact: {'ContactID': vendor.ContactID},
                    Date: (new Date()).toDateString(),
                    DeliveryDate: moment(new Date(schedule.start_date)).format('YYYY-MM-DD'),
                    Status: 'AUTHORISED',
                    LineAmountTypes: 'Exclusive',
                    LineItems: [
                        {
                            Description: schedule.full_course_name + ` for Greg Kockott on behalf of ${organisation}`,
                            UnitAmount: schedule.price,
                            TaxType: 'INPUT3',
                            Quantity: 1.0
                        }
                    ],
                    CurrencyCode: schedule.currency,
                };
                xero.purchaseOrders.create(PurchaseOrderObject).then((po) => {
                    tmp.file({
                        mode: 0o777,
                        prefix: 'tmp-',
                        postfix: '.pdf'
                    }, function _tempFileCreated(err, path, fd, cleanupCallback) {
                        if (err) throw err;
                        xero.purchaseOrders.savePDF({
                            PurchaseOrderID: po.PurchaseOrders[0].PurchaseOrderID,
                            PurchaseOrderNumber: po.PurchaseOrders[0].PurchaseOrderNumber,
                            savePath: path
                        }).then((obj) => {
                            console.log(path);
                            let pdfBuffer;
                            fs.readFile(path, async (err, data) => {
                                if (err) throw err;
                                pdfBuffer = data;
                                let jsonBuffer = JSON.parse(JSON.stringify(pdfBuffer));
                                jsonBuffer.base64Data = Buffer.from(jsonBuffer.data).toString('base64');
                                fs.unlinkSync(path);
                                cleanupCallback();
                                let dataInfo = await Firebase.uploadLocalFile(jsonBuffer, `PurchaseOrder/${vendor.id}/`, po.PurchaseOrders[0].PurchaseOrderNumber);
                                return resolve({poObject: po, uploadInfo: dataInfo});
                            });
                            return;
                        }).catch((e) => {
                            return reject(e);
                        })
                    });
                    return;
                }).catch(error => {
                    return reject(error);
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    deletePO(PO_Number, PO_ID) {
        return new Promise(async (resolve, reject) => {
            try {
                let PurchaseOrderObject = {
                    PurchaseOrderNumber: PO_Number,
                    PurchaseOrderID: PO_ID,
                    Status: 'DELETED'
                };
                xero.purchaseOrders.update(PurchaseOrderObject).then((po) => {
                    return resolve(po);
                }).catch(error => {
                    return reject(error);
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    updatePO(PO_Object) {
        return new Promise(async (resolve, reject) => {
            try {
                xero.purchaseOrders.update(PO_Object).then((po) => {
                    return resolve(po);
                }).catch(error => {
                    return reject(error);
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    getContact(req, res, next) {
        xero.contacts.get().then(contact => {
            return res.json(contact);
        }).catch(error => {
            return (error);
        });
    }

    getPO(req, res, next) {
        xero.purchaseOrders.get().then(po => {
            return res.json(po);
        }).catch(error => {
            return (error);
        });
    }

    createInvoice(vendor, schedule, vendorInvoice, bookedCourses) {
        return new Promise(async (resolve, reject) => {
            try {
                let InvoiceObject = {
                    Type: 'ACCPAY',
                    Contact: {'ContactID': vendor.ContactID},
                    Date: (new Date()).toDateString(),
                    DueDate: moment(new Date(schedule.start_date)).format('YYYY-MM-DD'),
                    Status: 'AUTHORISED',
                    LineAmountTypes: 'Exclusive',
                    LineItems: [
                        {
                            Description: schedule.full_course_name + ' for Greg Kockott',
                            UnitAmount: schedule.price,
                            TaxType: 'INPUT3',
                            Quantity: 1.0,
                            AccountCode: '310'
                        }
                    ],
                    CurrencyCode: schedule.currency,
                    InvoiceNumber: (new Date().getTime()) + Math.round(Math.random() * (10000) + 3)
                };
                xero.invoices.create(InvoiceObject).then(async (invoice) => {
                    let InvoiceID = invoice.Invoices[0].InvoiceID;
                    if (InvoiceID === '00000000-0000-0000-0000-000000000000') {
                        return resolve('error');
                    } else {
                        await this.attachInvoice(vendorInvoice, InvoiceID);
                        await this.updatePO({PurchaseOrderID: bookedCourses.PurchaseOrderID, Status: 'BILLED'});
                        return resolve(invoice);
                    }
                }).catch((error) => {
                    return reject(error);
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    attachInvoiceTest(req, res, next) {
            try {
                let filename = '1551762834484_dummy.pdf';
                filename = filename.substring(filename.indexOf('_')+1);
                let url = 'https://storage.googleapis.com/learn-by-hellocrowd.appspot.com/Employee%2FInvoice%2F1551762834484_dummy.pdf?GoogleAccessId=firebase-adminsdk-nf810%40learn-by-hellocrowd.iam.gserviceaccount.com&Expires=16447017600&Signature=X6M05NCsEhnh2SdZhRUIXbB09DIYYZLA1KxZ4Xm%2FJEsBSuyFlvlz9hym6MdZNb%2FRMHNJAH%2FTHi8%2FRXltm7%2FfNgEH4YHIkRAXrCHBNbgGARia6cym56cHLubA7EzkWoJ6ZLdrmCqQos3zBWOsucV7XTRHeyjZRRFUn%2Fl6vMSmmIoDqBgFomvX5UaK8Ziv6VPQJSvs%2FiKCSuqu6ZcbeOZo23VKZqxb0wGAjFwf4OTQK9yE4gm081LQ4HeK2Ydx3DqSPQD3SRBvThlakxIxzfdjb2B6eMEX%2BzVsugtGHA0dcuTbxR3zTNFkfrf1qgv%2BXZtCOpOlCCIXIe09kUCsf%2Fe3Sw%3D%3D';

                tmp.file({
                    mode: 0o777,
                    prefix: 'tmp-',
                    postfix: '.pdf'
                }, function _tempFileCreated(err, path, fd, cleanupCallback) {
                    if (err) throw err;
                    download(url)
                        .then((fileData) => {
                            fs.writeFile(path, fileData, {mode: 0o777, flag: 'w'}, (err) => {
                                if (err) return (err);
                                xero.invoices.attachments.uploadAttachment({
                                    entityId: '0f41fc82-0e42-4277-aff3-bdd24c48e0f1',
                                    fileName: filename,
                                    mimeType: 'application/pdf',
                                    pathToUpload: path,
                                    includeOnline: true
                                }).then((attachment) => {
                                    fs.unlinkSync(path);
                                    cleanupCallback();
                                    return res.json(attachment);
                                }).catch(error => {
                                    return (error);
                                });
                            });
                            return;
                        })
                        .catch((error) => {
                            console.error(error);
                            return error;
                        });
                });
            } catch (error) {
                return (error);
            }
    }

    attachInvoice(vendorInvoice, InvoiceID) {
        return new Promise(async (resolve, reject) => {
            try {
                let filename = vendorInvoice.filename;
                filename = filename.substring(filename.indexOf('_') + 1);
                let url = vendorInvoice.url;
                // let url = 'https://storage.googleapis.com/learn-by-hellocrowd.appspot.com/Employee%2FInvoice%2F1551762834484_dummy.pdf?GoogleAccessId=firebase-adminsdk-nf810%40learn-by-hellocrowd.iam.gserviceaccount.com&Expires=16447017600&Signature=X6M05NCsEhnh2SdZhRUIXbB09DIYYZLA1KxZ4Xm%2FJEsBSuyFlvlz9hym6MdZNb%2FRMHNJAH%2FTHi8%2FRXltm7%2FfNgEH4YHIkRAXrCHBNbgGARia6cym56cHLubA7EzkWoJ6ZLdrmCqQos3zBWOsucV7XTRHeyjZRRFUn%2Fl6vMSmmIoDqBgFomvX5UaK8Ziv6VPQJSvs%2FiKCSuqu6ZcbeOZo23VKZqxb0wGAjFwf4OTQK9yE4gm081LQ4HeK2Ydx3DqSPQD3SRBvThlakxIxzfdjb2B6eMEX%2BzVsugtGHA0dcuTbxR3zTNFkfrf1qgv%2BXZtCOpOlCCIXIe09kUCsf%2Fe3Sw%3D%3D';
                tmp.file({
                    mode: 0o777,
                    prefix: 'tmp-',
                    postfix: '.pdf'
                }, function _tempFileCreated(err, path, fd, cleanupCallback) {
                    if (err) throw err;
                    download(url)
                        .then((fileData) => {
                            fs.writeFile(path, fileData, {mode: 0o777, flag: 'w'}, (err) => {
                                if (err) return reject(err);
                                xero.invoices.attachments.uploadAttachment({
                                    entityId: InvoiceID,   //'0f41fc82-0e42-4277-aff3-bdd24c48e0f1',
                                    fileName: filename,
                                    mimeType: 'application/pdf',
                                    pathToUpload: path,
                                    includeOnline: true
                                }).then((attachment) => {
                                    fs.unlinkSync(path);
                                    cleanupCallback();
                                    return resolve(attachment);
                                }).catch(error => {
                                    return reject(error);
                                });
                            });
                            return;
                        })
                        .catch((error) => {
                            console.error(error);
                            return reject(error);
                        });
                });
            } catch (error) {
                return reject(error);
            }
        });
    }

    getInvoice(req, res, next) {
        xero.invoices.get({
            InvoiceID: 'a481c4fb-235b-4957-80f0-4164d6e3eddc'
        }).then((attachment) => {
            return res.json(attachment);
        }).catch(error => {
            return (error);
        });
    }

}

module.exports = new XeroService();
