"""Optional composition previews, separate from provider generation protocols."""

def needs_composition(document, shot):
    mode = shot.get('videoReferenceMode') or document.get('videoReferenceMode') or 'legacy'
    if mode != 'multimodal':
        return True
    if shot.get('compositionMode'):
        return shot['compositionMode'] == 'preview'
    image_id = shot.get('imageNode') or (shot.get('pipeline') or {}).get('imageNodeId')
    return any(n.get('id') == image_id and n.get('data', {}).get('assetId') for n in document.get('nodes', []))


def execution_edges(document):
    ignored = {(s.get('imageNode') or (s.get('pipeline') or {}).get('imageNodeId'),
                s.get('videoNode') or (s.get('pipeline') or {}).get('videoNodeId'))
               for s in document.get('shots', []) if not needs_composition(document, s)}
    return [e for e in document.get('edges', []) if (e.get('source'), e.get('target')) not in ignored]
