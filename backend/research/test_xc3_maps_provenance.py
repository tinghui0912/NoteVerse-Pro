"""Synthetic metadata tests only; no audio, MIDI or inference."""

import unittest

from xc3_maps_provenance import LICENSE, Page


class MapsMetadataTests(unittest.TestCase):
    def test_registration_is_not_dataset_inventory(self):
        page = Page('<h1>Information Registration</h1><form method="POST" action="submit.cgi">'
                    'E-mail Organization / Affiliation<input name="email"></form>',
                    'https://service.tsi.telecom-paristech.fr/cgi-bin/user-service/subscribe.cgi')
        self.assertTrue(page.registration)
        self.assertEqual(page.media_links, [])
        self.assertEqual(page.forms[0]['method'], 'POST')

    def test_navigation_does_not_prove_acoustic_file_identity(self):
        page = Page('<a href="/en/">Home</a><p>Yamaha Disklavier</p>', 'https://example.org/maps')
        self.assertFalse(page.registration)
        self.assertEqual(page.media_links, [])

    def test_license_is_not_media(self):
        page = Page(f'<a href="{LICENSE}deed.en">License</a>', 'https://example.org')
        self.assertEqual(page.links, [LICENSE + 'deed.en'])
        self.assertEqual(page.media_links, [])

    def test_media_links_are_metadata_not_downloads(self):
        page = Page('<a href="subset.zip">Archive</a><a href="piece.mid">MIDI</a>',
                    'https://example.org/maps/')
        self.assertEqual(page.media_links, ['https://example.org/maps/piece.mid',
                                           'https://example.org/maps/subset.zip'])

    def test_title_alone_does_not_prove_registration(self):
        self.assertFalse(Page('<h1>Registration</h1>', 'https://example.org').registration)


if __name__ == '__main__':
    unittest.main()
