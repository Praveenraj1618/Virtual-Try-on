"""Conservative upper-body collar correction; no model or GPU imports."""
import numpy as np
from PIL import Image, ImageFilter


def _attached_regions(mask, seeds):
    """Keep 8-connected ATR regions that overlap the independently labelled face."""
    attached = np.zeros(mask.shape, dtype=bool)
    stack = list(zip(*np.where(mask & seeds)))
    attached[mask & seeds] = True
    height, width = mask.shape
    while stack:
        y, x = stack.pop()
        for ny in range(max(0, y - 1), min(height, y + 2)):
            for nx in range(max(0, x - 1), min(width, x + 2)):
                if mask[ny, nx] and not attached[ny, nx]:
                    attached[ny, nx] = True
                    stack.append((ny, nx))
    return attached


def upper_body_masks(lip, atr, upstream_mask):
    lip, atr = np.asarray(lip), np.asarray(atr)
    protect = np.isin(lip, [1, 2, 4, 13]) | np.isin(atr, [1, 2, 3, 11])
    protected = np.asarray(Image.fromarray(protect.astype(np.uint8) * 255)
                           .filter(ImageFilter.MaxFilter(5))) > 0
    collar = np.zeros(lip.shape, dtype=bool)
    ys, xs = np.where(lip == 13)
    if len(ys) >= 16:
        # Only release LIP-labelled clothing below the LIP face, near the neck.
        # ATR's face class may include neck/collar; never override hair/accessories
        # or LIP face, and never infer editable skin from RGB colour.
        height = int(ys.max() - ys.min() + 1)
        width = int(xs.max() - xs.min() + 1)
        yy, xx = np.indices(lip.shape)
        neck_band = ((yy > ys.max()) & (yy <= ys.max() + max(2, round(height * .65)))
                     & (xx >= xs.min() - round(width * .25))
                     & (xx <= xs.max() + round(width * .25)))
        collar = neck_band & np.isin(lip, [5, 6, 7]) & ~np.isin(atr, [1, 2, 3])
    released = collar.copy()
    if len(ys) >= 16:
        attached = _attached_regions(atr == 11, lip == 13)
        # Remove detached false face islands only below the true face and near
        # upper clothing. Never change face/hair/accessory labels from LIP.
        clothes = np.isin(lip, [5, 6, 7])
        nearby = np.asarray(Image.fromarray(clothes.astype(np.uint8) * 255)
                            .filter(ImageFilter.MaxFilter(15))) > 0
        detached = (atr == 11) & ~attached & (yy > ys.max()) & nearby
        detached &= ~np.isin(lip, [1, 2, 4, 13, 14, 15])
        # ATR upper clothing can resolve LIP background holes at the collar;
        # leave face-labelled neck skin alone when the parsers disagree.
        holes = neck_band & (lip == 0) & np.isin(atr, [4, 7])
        released |= detached | holes
        # Discard the dilation halo of detached islands too, but only over
        # clothing/background pixels near those islands.
        halo = np.asarray(Image.fromarray(detached.astype(np.uint8) * 255)
                          .filter(ImageFilter.MaxFilter(5))) > 0
        released |= halo & nearby & np.isin(lip, [0, 5, 6, 7]) & ~np.isin(atr, [1, 2, 3]) & ~attached
    protected = protected & ~released
    # Upstream may also have excluded these collar pixels. Restore them before
    # applying protection, so inference and final compositing use the same mask.
    edit = ((np.asarray(upstream_mask.convert("L")) > 127) | released) & ~protected
    return (Image.fromarray(edit.astype(np.uint8) * 255),
            Image.fromarray(protected.astype(np.uint8) * 255))
