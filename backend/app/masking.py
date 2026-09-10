"""Conservative upper-body collar correction; no model or GPU imports."""
import numpy as np
from PIL import Image, ImageFilter


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
    protected = protected & ~collar
    # Upstream may also have excluded these collar pixels. Restore them before
    # applying protection, so inference and final compositing use the same mask.
    edit = ((np.asarray(upstream_mask.convert("L")) > 127) | collar) & ~protected
    return (Image.fromarray(edit.astype(np.uint8) * 255),
            Image.fromarray(protected.astype(np.uint8) * 255))
