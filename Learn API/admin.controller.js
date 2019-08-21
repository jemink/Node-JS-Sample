const functions = require('firebase-functions');
const httpStatus = require('http-status');
const moment = require('moment-timezone');
const _ = require('lodash');
const Vendor = require('../models/vendor.model');
const Admin = require('../models/admin.model');
const JWT = require('jsonwebtoken');
const Firebase = require('../services/firebase.service');
const Utilities = require('../services/utilities.service');
const Xero = require('../services/xero.service');
const Mail = require('../services/mail.service');
const Log = require('../services/logs.service');
const APIError = require('../helpers/APIError');

class AdminController {
    async documentStatusUpdate(req, res, next) {
        let vendorId = req.body.vendorId,
            type = req.body.type,
            status = req.body.status;
        const vendor = await Firebase.getUser(vendorId);
        if (status === 'approved') {
            vendor.documentation[type].status = 'approved';
        } else {
            vendor.documentation[type].status = 'rejected';
        }
        Firebase.updateDoc('vendors', vendorId, vendor)
            .then(async (response) => {
                await Log.new('info', `Document ${status}`, 'admin',
                    {vendorId},
                    `${req.user.full_name}(admin) ${status} ${type} of ${vendor.company_name}`);
                return res.send({success: true});
            })
            .catch(async (error) => {
                console.log(error);
                await Log.new('error', `Document ${status}`, 'admin',
                    {vendorId},
                    `Error when ${req.user.full_name}(admin) ${status} ${type} of ${vendor.company_name}, Error : ${error.message}`);
                return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
            });
    }

    async approvalEmail(req, res, next) {
        let vendorId = req.body.vendorId;
        const vendor = await Firebase.getUser(vendorId);
        const env = Utilities.getEvnironment(req.get('origin'));
        //retrieving only ContactID
        vendor.ContactID = await Xero.createContact(vendor);
        if (vendor.ContactID === 'error') {
            return res.send({error: 'Duplicate Vendor Name'});
        } else {
            await Log.new('info', `Contact Created`, 'admin',
                {vendorId},
                `${req.user.full_name}(admin) approved ${vendor.company_name}. Contact created for ${vendor.company_name}`);
            Mail.vendorApplicationApprovedEmail(vendor, env)
                .then(async (response) => {
                    await Log.new('info', `Mail Sent`, 'admin',
                        {vendorId},
                        `${req.user.full_name}(admin) approved ${vendor.company_name}. Approvation mail sent to ${vendor.company_name}`);
                    vendor.company_profile.status = 'Active';
                    Firebase.updateDoc('vendors', vendorId, vendor)
                        .then(async (response) => {
                            await Log.new('info', `Vendor Approved`, 'admin',
                                {vendorId},
                                `${req.user.full_name}(admin) approved ${vendor.company_name}. ${vendor.company_name}(vendor) status : ${vendor.company_profile.status}`);
                            return res.send({success: true});
                        })
                        .catch(async (error) => {
                            console.log(error);
                            await Log.new('error', `Vendor Approvation`, 'admin',
                                {vendorId},
                                `Error while updating Vendor's details after ${req.user.full_name}(admin) approved ${vendor.company_name}.
                                 Contact created and mail sent to ${vendor.company_name}.
                                 Error : ${error.message}`);
                            return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
                        });
                    return;
                })
                .catch((error) => {
                    return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
                });
        }
    }

    async actionRequirdEmail(req, res, next) {
        let vendorId = req.body.vendorId,
            reasons = req.body.reasons;
        const env = Utilities.getEvnironment(req.get('origin'));
        const vendor = await Firebase.getUser(vendorId);
        Mail.vendorActionRequiedEmail(vendor, reasons, env)
            .then(async (response) => {
                await Log.new('info', `Mail Sent`, 'admin',
                    {vendorId},
                    `${req.user.full_name}(admin) rejected ${vendor.company_name}. Acknowledgment mail sent to ${vendor.company_name}.`);
                vendor.company_profile.status = 'Rejected';
                Firebase.updateDoc('vendors', vendorId, vendor)
                    .then(async (response) => {
                        await Log.new('info', `Vendor Rejected`, 'admin',
                            {vendorId},
                            `${req.user.full_name}(admin) rejected ${vendor.company_name}. ${vendor.company_name}(vendor) status : ${vendor.company_profile.status}`);
                        return res.send({success: true});
                    })
                    .catch((error) => {
                        console.log(error);
                        return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
                    });
                return;
            })
            .catch((error) => {
                return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
            });
    }

    async googleSignup(req, res, next) {
        console.log('[googleSignup]', req.body);
        let token = req.body.token;
        let userData = req.body.user;
        // console.log('\n USER DATA:', userData);
        let data;
        try {
            data = await Firebase.signInWithCredentialAndReturnData(token, userData);
            // console.log('\n DATA: \n', data);
        } catch (error) {
            console.log(error);
            return next(new APIError('Error', httpStatus.FORBIDDEN));
        }
        // Get user
        let user = await Firebase.getUserByEmail('admins', data.email);
        if (user && user.invited) {
            // console.log('user exists');
            Firebase.updateUser(user.id, 'admins', {
                invitationStatus: 'Active',
                icon_url: data.picture || null,
                full_name: data.name,
                id: user.id
            });
            return res.json({
                access_token: JWT.sign({user_id: user.id, role: 'admin'}, functions.config().main.private_key, {
                    expiresIn: '180 days'
                }),
                signed_up: true,
                email: user.email
            });
        } else {
            let currentUser = await Firebase.getCurrentUser();
            currentUser
                .delete()
                .then(() => {
                    // User deleted.
                    console.log('User Deleted');
                    return;
                })
                .catch((error) => {
                    // An error happened.
                    console.log(error);
                });
            return next(new APIError('User is not invited', httpStatus.NOT_ACCEPTABLE));
        }
    }

    async inviteUser(req, res, next) {
        console.log('inviteUser');
        const email = req.body.email ? req.body.email.toLowerCase() : null;
        const first_name = req.body.first_name;
        const type = req.body.account_type;
        let updateData;
        if (!email) {
            return next(new APIError('Email is required', httpStatus.NOT_ACCEPTABLE));
        }
        updateData = {
            email: email,
            first_name: first_name,
            type: type
        };
        try {
            const data = Admin.setInvitationToken();
            Mail.invitationEmail(updateData, data.url)
                .then(async (response) => {
                    await Log.new('info', `Mail Sent`, 'admin',
                        {userId: req.user.id},
                        `Invitation mail sent to ${updateData.first_name}(${updateData.email}) from ${req.user.full_name}(${req.user.type}).`);

                    Firebase.getUserByEmail('admins', email)
                        .then((user) => {
                            if (user) {
                                Firebase.updateUser(user.id, 'admins', {
                                    invitation_url: data.url,
                                    invitation_expiration_time: Date.now() + 3600000,
                                    invitation_token: data.invitation_token,
                                    invited: true,
                                    type: updateData.type,
                                    first_name: updateData.first_name,
                                    invitationStatus: 'Pending'
                                });
                            } else {
                                Firebase.pushDoc('admins', {
                                    invitation_url: data.url,
                                    invitation_expiration_time: Date.now() + 3600000,
                                    invitation_token: data.invitation_token,
                                    invited: true,
                                    invitationStatus: 'Pending',
                                    type: updateData.type,
                                    first_name: updateData.first_name,
                                    email: updateData.email
                                });
                            }
                            return res.json({success: true});
                        })
                        .catch((error) => {
                            console.log(error);
                            return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
                        });
                    return;
                })
                .catch((error) => {
                    console.log(error);
                    return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
                });
        } catch (error) {
            console.log(error);
            return next(new APIError(error, httpStatus.NOT_ACCEPTABLE));
        }
    }

    async checkInvitationToken(req, res, next) {
        let invitation_token = req.body.invitation_token;
        const admin = await Firebase.getOneWhere('admins', 'invitation_token', invitation_token);
        if (admin) {
            let oldDate = new Date(admin.invitation_expiration_time);
            let newDate = new Date();
            if (newDate <= oldDate) {
                return res.send({token_valid: true});
            } else {
                return res.send({token_valid: false});
            }
        } else {
            return next(new APIError('Token Not Found', httpStatus.NOT_ACCEPTABLE));
        }
    }

    getAll(req, res, next) {
        console.log('[getAll]');
        Firebase.getAll('admins')
            .then((courses) => {
                return res.json(courses);
            })
            .catch((error) => {
                console.log(error);
                return next(new APIError('ERROR', httpStatus.INTERNAL_SERVER_ERROR));
            });
    }

    deleteUser(req, res, next) {
        let userId = req.params.id;
        Admin.deleteUser(userId)
            .then(async () => {
                    await Log.new('info', 'User Deleted', 'admin',
                        {userId},
                        `${req.user.full_name}(${req.user.type}) removed a user`);
                    return res.json({
                        id: userId,
                        success: true
                    });
                }
            ).catch(async (error) => {
            console.log(error);
            await Log.new('error', 'User Deletion', 'admin',
                {userId},
                `Error while ${req.user.full_name}(admin) tried to removed a user, error : ${error.message}`);
            return next(new APIError('ERROR', httpStatus.INTERNAL_SERVER_ERROR));
        });
    }

    async getAllBookings(req, res, next) {
        console.log('👨🏻‍💻 getAllBookings');
        try {
            const tenantsIds = (await Firebase.getAll(`tenants`)).map((t) => t.id);
            const employees = [];
            await Promise.all(
                tenantsIds.map(async (tenantId) => {
                    const tenantEmployees = (await Firebase.getAll(`tenants/${tenantId}/employees`))
                        .filter((employee) => employee.booked_courses && employee.booked_courses.length)
                        .map((employee) => {
                            employee.tenantId = tenantId;
                            return employee;
                        });
                    if (tenantEmployees.length) {
                        employees.push(...tenantEmployees);
                    }
                })
            );
            const coursesIds = [];
            employees.forEach((employee) => {
                employee.booked_courses.forEach((bc) => {
                    if (coursesIds.indexOf(bc.scheduleId) === -1) {
                        coursesIds.push(bc.scheduleId);
                    }
                });
            });

            const courses = (await Promise.all(
                coursesIds.map((id) => Firebase.getDoc(`courses_schedules`, id))
            )).filter((course) => course);

            const bookings = [];
            employees.forEach((employee) => {
                employee.booked_courses.forEach((bc) => {
                    const course = courses.find((course) => course.id === bc.scheduleId);
                    const documents =
                        (employee.documents && employee.documents.find((d) => d.scheduleId === bc.scheduleId)) || null;
                    if (course && course.course_status && course.course_status.type !== 'cancelled') {
                        const booking = {
                            employee_id: employee.id,
                            tenant_id: employee.tenantId,
                            name: employee.full_name || '',
                            email: employee.email,
                            booking_data: bc,
                            course,
                            documents
                        };
                        bookings.push(booking);
                    }
                });
            });
            const groupedBookings = _.groupBy(bookings, (booking) => {
                return moment(booking.course.start_date, 'ddd, D MMM YYYY').format('YYYY-MM');
            });
            let result = [];
            for (const key in groupedBookings) {
                if (groupedBookings.hasOwnProperty(key)) {
                    const group = groupedBookings[key];

                    result.push({
                        dateGroup: key,
                        groupMonth: moment(key, 'YYYY-MM').format('MMMM'),
                        groupYear: moment(key, 'YYYY-MM').format('YYYY'),
                        bookings: group.sort(
                            (a, b) =>
                                moment(a.course.start_date, 'ddd, D MMM YYYY') -
                                moment(b.course.start_date, 'ddd, D MMM YYYY')
                        )
                    });
                }
            }
            result = result.sort((a, b) => moment(a.dateGroup, 'YYYY-MM') - moment(b.dateGroup, 'YYYY-MM'));
            return res.json(result);
        } catch (error) {
            return next(new APIError(error, httpStatus.INTERNAL_SERVER_ERROR));
        }
    }

    async getVendorData(req, res, next) {
        try {
            const vendorId = req.params.vendorId;
            const vendor = await Firebase.getDoc(`vendors`, vendorId);
            if (!vendor) {
                return next(new APIError('Vendor not found', httpStatus.NO_CONTENT));
            }
            return res.json(
                _.omit(vendor, ['otp_pin', 'pin_expiration_time', 'registered', 'step_completed', 'user_id'])
            );
        } catch (error) {
            return next(new APIError(error, httpStatus.INTERNAL_SERVER_ERROR));
        }
    }

    async getHellocrowdData(req, res, next) {
        try {
            const hellocrowdData = await Firebase.getDoc(`hellocrowd`, 'config');
            return res.json(hellocrowdData);
        } catch (error) {
            return next(new APIError(error, httpStatus.INTERNAL_SERVER_ERROR));
        }
    }

    async approveDocument(req, res, next) {
        try {
            const tenantId = req.body.tenantId;
            const employeeId = req.body.employeeId;
            const scheduleId = req.body.scheduleId;
            const documentType = req.body.documentType;
            if (!tenantId || !employeeId || !scheduleId || !documentType) {
                return next(new APIError('Insufficient data', httpStatus.UNPROCESSABLE_ENTITY));
            }
            if (['invoice', 'attendance_register'].indexOf(documentType) === -1) {
                return next(new APIError('Document type is not correct', httpStatus.CONFLICT));
            }
            const employee = await Firebase.getDoc(`tenants/${tenantId}/employees`, employeeId);
            if (!employee) {
                return next(new APIError('Employee not found', httpStatus.NO_CONTENT));
            }
            if (!employee.documents || !employee.documents.find((d) => d.scheduleId === scheduleId)) {
                return next(new APIError('Document not found', httpStatus.NO_CONTENT));
            }
            const documents = employee.documents.find((d) => d.scheduleId === scheduleId);
            if (documents.status === 'approved') {
                return next(new APIError('All documents were approved', httpStatus.NO_CONTENT));
            }

            documents[documentType + '_details'].status = 'approved';
            documents[documentType + '_details'].approvedAt = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            delete documents[documentType + '_details'].rejectedAt;
            //check if both documents are approved
            const docData = Object.values(_.pick(documents, ['attendance_register_details', 'invoice_details'])).map(
                (d) => d.status
            );
            const bookedCourses = employee.booked_courses.find((bc) => bc.scheduleId === scheduleId);
            if (bookedCourses && bookedCourses.noShow === true && documents['invoice_details'].status === 'approved') {
                documents.status = 'approved';
            } else {
                documents.status = docData.every((s) => s === 'approved') && docData.length === 2 ? 'approved' : 'pending';
            }
            documents.statusUpdatedAt = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            if (documents.status === 'approved' && !documents.invoice_ID) {
                const schedule = await Firebase.getDoc('courses_schedules', scheduleId);
                const vendor = await Firebase.getUser(schedule.vendor_id);
                let invoiceObject = await Xero.createInvoice(vendor, schedule, documents.invoice_details, bookedCourses);
                if (invoiceObject === 'error') {
                    return next(
                        new APIError('Error Occurred while generating Invoice', httpStatus.UNPROCESSABLE_ENTITY)
                    );
                } else {
                    documents.invoice_ID = invoiceObject.Invoices[0].InvoiceID;
                    documents.invoice_Number = invoiceObject.Invoices[0].InvoiceNumber;
                    await Log.new('info', `Acc PAY invoice created`, tenantId,
                        {
                            employeeId,
                            scheduleId,
                            invoiceID: documents.invoice_ID,
                            invoiceNumber: documents.invoice_Number
                        },
                        `Acc PAY invoice created`);
                }
            }
            await Firebase.updateDoc(`tenants/${tenantId}/employees`, employeeId, employee);
            await Log.new('info', `Approved ${documentType}`, tenantId,
                {employeeId, scheduleId},
                `${req.user.full_name}(${req.user.type}) approved ${documentType} of Employee`);
            return res.json(employee.documents);
        } catch (error) {
            return next(new APIError(error, httpStatus.INTERNAL_SERVER_ERROR));
        }
    }

    async rejectDocument(req, res, next) {
        try {
            const tenantId = req.body.tenantId;
            const employeeId = req.body.employeeId;
            const scheduleId = req.body.scheduleId;
            const documentType = req.body.documentType;
            if (!tenantId || !employeeId || !scheduleId || !documentType) {
                return next(new APIError('Insufficient data', httpStatus.UNPROCESSABLE_ENTITY));
            }
            if (['invoice', 'attendance_register'].indexOf(documentType) === -1) {
                return next(new APIError('Document type is not correct', httpStatus.CONFLICT));
            }
            const employee = await Firebase.getDoc(`tenants/${tenantId}/employees`, employeeId);
            if (!employee) {
                return next(new APIError('Employee not found', httpStatus.NO_CONTENT));
            }
            if (!employee.documents || !employee.documents.find((d) => d.scheduleId === scheduleId)) {
                return next(new APIError('Document not found', httpStatus.NO_CONTENT));
            }
            const documents = employee.documents.find((d) => d.scheduleId === scheduleId);
            if (documents.status === 'approved') {
                return next(new APIError('All documents were approved', httpStatus.NO_CONTENT));
            }
            documents[documentType + '_details'].status = 'rejected';
            documents[documentType + '_details'].rejectedAt = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            delete documents[documentType + '_details'].approvedAt;
            //check if both documents are approved
            documents.status = 'pending';
            documents.statusUpdatedAt = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            await Firebase.updateDoc(`tenants/${tenantId}/employees`, employeeId, employee);
            await Log.new('info', `Rejected ${documentType}`, tenantId,
                {employeeId, scheduleId},
                `${req.user.full_name}(${req.user.type}) rejected ${documentType} of Employee`);
            return res.json(employee.documents);
        } catch (error) {
            return next(new APIError(error, httpStatus.INTERNAL_SERVER_ERROR));
        }
    }
}

module.exports = new AdminController();
