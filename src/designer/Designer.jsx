// Example snippet to add inside Designer.jsx controls panel
import { useState } from 'react';
import { processImageToHeightmap } from './utils/imageProcessor';

export function ImageControls({ onParamsChange }) {
  const [params, setParams] = useState({
    embossDepth: 1.5,
    invert: false,
    repeatX: 1,
    heightmapData: null,
  });

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const heightmap = await processImageToHeightmap(file, 256);
      const newParams = { ...params, heightmapData: heightmap };
      setParams(newParams);
      onParamsChange(newParams);
    }
  };

  const handleSliderChange = (key, value) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    onParamsChange(newParams);
  };

  return (
    <div className="control-panel">
      <h3>Import Image & Emboss</h3>
      
      <input 
        type="file" 
        accept="image/*" 
        onChange={handleImageUpload} 
      />

      <label>Emboss Depth (mm)</label>
      <input 
        type="range" 
        min="-5" 
        max="5" 
        step="0.1" 
        value={params.embossDepth} 
        onChange={(e) => handleSliderChange('embossDepth', parseFloat(e.target.value))} 
      />

      <label>Wrap Repeat Count</label>
      <input 
        type="range" 
        min="1" 
        max="6" 
        step="1" 
        value={params.repeatX} 
        onChange={(e) => handleSliderChange('repeatX', parseInt(e.target.value))} 
      />

      <label>
        <input 
          type="checkbox" 
          checked={params.invert} 
          onChange={(e) => handleSliderChange('invert', e.target.checked)} 
        />
        Invert Image
      </label>
    </div>
  );
}
