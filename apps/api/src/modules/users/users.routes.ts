import { Router } from 'express';
import { addressSchema, objectId, updateProfileSchema } from '@tadka/shared';
import { badRequest, notFound, parse } from '../../lib/errors';
import { currentUser, requireAuth } from '../../middleware/auth';
import { fromPoint, toPoint } from '../../models/common';
import { AddressModel, UserModel, type Address } from '../../models/user';
import { serializeUser } from '../auth/auth.routes';
import { findZoneFor } from '../../services/geo';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.patch('/me', async (req, res) => {
  const input = parse(updateProfileSchema, req.body);
  const user = await UserModel.findByIdAndUpdate(currentUser(req).id, { $set: input }, { new: true, runValidators: true });
  if (!user) throw notFound('User');
  res.json({ user: serializeUser(user) });
});

export function serializeAddress(a: Address & { _id: unknown }) {
  return {
    id: String(a._id),
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    locality: a.locality,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    location: fromPoint(a.location),
  };
}

export const addressesRouter = Router();
addressesRouter.use(requireAuth);

addressesRouter.get('/', async (req, res) => {
  const list = await AddressModel.find({ userId: currentUser(req).id }).sort({ updatedAt: -1 }).lean();
  const out = await Promise.all(
    list.map(async (a) => ({ ...serializeAddress(a), serviceable: !!(await findZoneFor(fromPoint(a.location)!)) })),
  );
  res.json({ addresses: out });
});

addressesRouter.post('/', async (req, res) => {
  const input = parse(addressSchema, req.body);
  const count = await AddressModel.countDocuments({ userId: currentUser(req).id });
  if (count >= 10) throw badRequest('You can save up to 10 addresses');
  const a = await AddressModel.create({ ...input, userId: currentUser(req).id, location: toPoint(input.location) });
  const zone = await findZoneFor(input.location);
  res.status(201).json({ address: { ...serializeAddress(a.toObject()), serviceable: !!zone } });
});

addressesRouter.put('/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const input = parse(addressSchema, req.body);
  const a = await AddressModel.findOneAndUpdate(
    { _id: id, userId: currentUser(req).id },
    { $set: { ...input, location: toPoint(input.location) } },
    { new: true },
  ).lean();
  if (!a) throw notFound('Address');
  res.json({ address: serializeAddress(a) });
});

addressesRouter.delete('/:id', async (req, res) => {
  const id = parse(objectId, req.params.id);
  const r = await AddressModel.deleteOne({ _id: id, userId: currentUser(req).id });
  if (!r.deletedCount) throw notFound('Address');
  res.json({ ok: true });
});
