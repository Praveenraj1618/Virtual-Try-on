import unittest
import numpy as np
from PIL import Image
from backend.app.masking import upper_body_masks


class CollarMaskTests(unittest.TestCase):
    def inputs(self):
        lip = np.zeros((80, 80), dtype=np.uint8)
        lip[10:30, 25:45] = 13
        lip[30:50, 20:50] = 7
        atr = np.zeros_like(lip)
        atr[10:40, 25:45] = 11
        return lip, atr, Image.new("L", (80, 80))

    def test_conflicting_collar_is_editable_but_face_is_protected(self):
        lip, atr, raw = self.inputs()
        edit, protected = map(np.asarray, upper_body_masks(lip, atr, raw))
        self.assertEqual(edit[33, 30], 255)
        self.assertEqual(protected[33, 30], 0)
        self.assertTrue(np.all(protected[lip == 13] == 255))
        self.assertTrue(np.all(edit[lip == 13] == 0))
        self.assertFalse(np.any((edit > 0) & (protected > 0)))
        self.assertEqual(edit[48, 30], 0)  # outside the bounded neck band

    def test_hair_and_unlabelled_neck_are_not_released(self):
        lip, atr, raw = self.inputs()
        atr[33, 30] = 2
        lip[34, 31] = 0
        edit, protected = map(np.asarray, upper_body_masks(lip, atr, raw))
        for y, x in [(33, 30), (34, 31)]:
            self.assertEqual(edit[y, x], 0)
            self.assertEqual(protected[y, x], 255)

    def test_without_lip_face_no_collar_is_invented(self):
        lip, atr, raw = self.inputs()
        lip[lip == 13] = 0
        edit, protected = map(np.asarray, upper_body_masks(lip, atr, raw))
        self.assertFalse(np.any(edit))
        self.assertEqual(protected[33, 30], 255)
