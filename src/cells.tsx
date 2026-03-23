interface JobCellProps {
  title: string
  company: string
  location: string
  companyLogo?: string
  fitScore?: string
  url?: string
  skills?: string[]
}

interface CourseCellProps {
  title: string
  provider: string
  level: string
  image?: string
  rating?: string
  price?: string
  url?: string
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="cell-field">
      <span className="cell-label">{label}</span>
      <span className="cell-value">{value}</span>
    </div>
  )
}

function Logo({
  src,
  alt,
}: {
  src?: string
  alt: string
}) {
  if (!src) {
    return <div className="cell-logo-placeholder">{alt.slice(0, 1).toUpperCase()}</div>
  }

  return <img className="cell-logo" src={src} alt={alt} loading="lazy" />
}

export function JobCell({
  title,
  company,
  location,
  companyLogo,
  fitScore,
  url,
  skills,
}: JobCellProps) {
  const inner = (
    <>
      <div className="cell-media">
        <Logo src={companyLogo} alt={company || title} />
      </div>
      <Field label="Title" value={title || 'Untitled'} />
      <Field label="Company" value={company || 'Unknown'} />
      <Field label="Location" value={location || 'Not specified'} />
      <Field label="Fit" value={fitScore || 'n/a'} />
      {url ? (
        <a
          className="cell-link"
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          View →
        </a>
      ) : <span />}
      {skills && skills.length > 0 ? (
        <div className="cell-skills">
          {skills.map((skill, i) => (
            <span key={`${skill}-${i}`} className="skill-tag">
              {skill}
            </span>
          ))}
        </div>
      ) : null}
    </>
  )

  return <div className="desktop-cell">{inner}</div>
}

export function CourseCell({
  title,
  provider,
  level,
  image,
  rating,
  price,
  url,
}: CourseCellProps) {
  return (
    <div className="desktop-cell">
      <div className="cell-media">
        <Logo src={image} alt={title || 'Course'} />
      </div>
      <Field label="Title" value={title || 'Untitled'} />
      <Field label="Provider" value={provider || 'Unknown'} />
      <Field label="Level" value={level || 'Not specified'} />
      <Field label="Rating / Price" value={`${rating || 'n/a'} · ${price || 'n/a'}`} />
      {url ? (
        <a className="cell-link" href={url} target="_blank" rel="noreferrer">
          View →
        </a>
      ) : <span />}
    </div>
  )
}
