import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Plan from '../models/Plan.js';
import Subscription from '../models/Subscription.js';
import ApiError from '../utils/ApiError.js';
import { msg91Service } from '../services/index.js';
const createLead = catchAsync(async (req, res) => {
  const leadData = { ...req.body };
  
  if (req.file) {
      leadData.paymentScreenshot = req.file.path.replace(/\\/g, "/"); // Normalize path for Windows
  }

  // IP Address
  leadData.ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

  const { verificationToken } = req.body;
  if (!verificationToken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Email verification required. Please verify your email.');
  }

  try {
      // Verify Token
      const payload = await import('../services/token.service.js').then(m => m.default.verifyToken(verificationToken, 'EMAIL_VERIFICATION'));
      
      // Ensure Email Matches
      if (payload.sub !== req.body.email) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Verification token does not match provided email');
      }
      
      if (payload.type !== 'EMAIL_VERIFICATION') {
           throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid token type');
      }

  } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired verification token');
  }

  // Check Uniqueness
  if (await User.findOne({ email: leadData.email })) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'User already exists with this email');
  }
  
  if (await Lead.findOne({ email: leadData.email })) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Inquiry already submitted with this email');
  }

  // Mark Verified
  leadData.isEmailVerified = true;

  const lead = await Lead.create(leadData);
  res.status(httpStatus.CREATED).send(lead);
});

const getLeads = catchAsync(async (req, res) => {
  // Simple get all for admin
  const leads = await Lead.find({}).sort({ createdAt: -1 });
  res.send(leads);
});

const approveLead = catchAsync(async (req, res) => {
    const { id } = req.params;
    const lead = await Lead.findById(id);
    if (!lead) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
    }

    if (lead.status === 'CONVERTED') {
         throw new ApiError(httpStatus.BAD_REQUEST, 'Lead already approved');
    }

    // 1. Check if user exists
    let user = await User.findOne({ email: lead.email });
    if (!user) {
        // 2. Create User
        user = await User.create({
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            password: lead.password || 'Mspk@123', // Fallback if no password provided
            profile: { city: lead.city },
            role: 'user',
            isEmailVerified: true,
            isPhoneVerified: true // Admin approved, implying phone is verified or trusted
        });
    }

    // 3. Find Plans and Create Subscriptions
    const planNames = lead.plan.split(',').map(p => p.trim());
    const validPlans = [];
    const activePlanNames = [];

    for (const planName of planNames) {
        let planDoc;
        if (planName === 'Demo') {
             planDoc = await Plan.findOne({ isDemo: true });
        } else {
             // Find plan by name (loose match)
             planDoc = await Plan.findOne({ name: planName });
             if (!planDoc) {
                 planDoc = await Plan.findOne({ name: { $regex: planName, $options: 'i' } });
             }
        }

        if (planDoc) {
            validPlans.push(planDoc);
            
            // 4. Create Subscription for each valid plan
            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + planDoc.durationDays);

            await Subscription.create({
                user: user._id,
                plan: planDoc._id,
                status: 'active',
                startDate: startDate,
                endDate: endDate
            });
            
            activePlanNames.push(planDoc.name);
        }
    }

    // 5. Update user signal access (Legacy Support & Aggregated View)
    if (activePlanNames.length > 0) {
        // Use the longest expiry date for the main user record if needed, 
        // or just keep the last one. For string display, join them.
        const planString = activePlanNames.join(', ');
        
        // Find max expiry (optional, just rough estimate for user model)
        const commonExpiry = new Date(); 
        commonExpiry.setDate(commonExpiry.getDate() + 30); // Default placeholder
        
        user.subscription = { plan: planString, expiresAt: commonExpiry };
        await user.save();
    }

    // 6. WhatsApp Welcome Message (MSG91)
    const welcomeTemplate = process.env.MSG91_WELCOME_TEMPLATE_ID || 'welcome_msg';
    // Mapping components: Body 1: Name, Body 2: Email, Body 3: Password
    const components = {
        "1": user.name,
        "2": user.email,
        "3": lead.password || '*****'
    };
    
    msg91Service.sendWhatsapp(lead.phone, welcomeTemplate, components).catch(err => console.error("MSG91 WA Failed:", err.message));

    // 7. Update Lead Status
    lead.status = 'CONVERTED';
    await lead.save();

    res.send({ user, message: 'Lead approved and subscriptions created successfully' });
});

const getLead = catchAsync(async (req, res) => {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Inquiry not found');
    }
    res.send(lead);
});

const updateLead = catchAsync(async (req, res) => {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!lead) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Inquiry not found');
    }
    res.send(lead);
});

const deleteLead = catchAsync(async (req, res) => {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Inquiry not found');
    }
    res.status(httpStatus.NO_CONTENT).send();
});

export default {
  createLead,
  getLeads,
  getLead,
  updateLead,
  deleteLead,
  approveLead
};
