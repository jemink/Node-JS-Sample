const Router = require('express').Router;
const router = new Router();

const asyncMiddleware = require('../helpers/async.middleware');
const adminController = require('../controllers/admin.controller');
const passport = require('passport');
//Auth
const JwtStrategy = require('../auth/auth.jwt');
passport.use(JwtStrategy);
const guard = [passport.authenticate('jwt', { session: false })];

router.route('/list').get(asyncMiddleware((...args) => adminController.getAll(...args)));

router.route('/vendor-approval').post(guard, asyncMiddleware((...args) => adminController.approvalEmail(...args)));
router.route('/vendor-action-require').post(guard, asyncMiddleware((...args) => adminController.actionRequirdEmail(...args)));
router
    .route('/vendor-document-status')
    .post(guard, asyncMiddleware((...args) => adminController.documentStatusUpdate(...args)));

router.route('/signin-google').post(asyncMiddleware((...args) => adminController.googleSignup(...args)));
router.route('/signup-google').post(asyncMiddleware((...args) => adminController.googleSignup(...args)));

router.route('/invite-user').post(guard, asyncMiddleware((...args) => adminController.inviteUser(...args)));
router.route('/invite-user/:id').delete(guard, asyncMiddleware((...args) => adminController.deleteUser(...args)));

router.route('/verify-invited-user').post(asyncMiddleware((...args) => adminController.checkInvitationToken(...args)));

// Bookings
router.route('/bookings').get(guard, asyncMiddleware((...args) => adminController.getAllBookings(...args)));

router.route('/vendor/:vendorId').get(asyncMiddleware((...args) => adminController.getVendorData(...args)));
router.route('/hellocrowd').get(asyncMiddleware((...args) => adminController.getHellocrowdData(...args)));
router.route('/documents/approve').post(guard, asyncMiddleware((...args) => adminController.approveDocument(...args)));
router.route('/documents/reject').post(guard, asyncMiddleware((...args) => adminController.rejectDocument(...args)));

module.exports = router;
